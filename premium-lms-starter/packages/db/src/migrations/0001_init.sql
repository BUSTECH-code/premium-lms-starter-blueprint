-- =============================================================================
-- 0001_init.sql — core schema (Phase 1 foundation)
--
-- Source of truth for concepts: docs/architecture/domain-model.md,
-- docs/architecture/state-machines.md, docs/product/business-rules.md.
-- Statuses below come from the proposed state models; transitions not yet
-- approved (e.g. In Review workflow, O-03) are represented as allowed *values*
-- only — using them requires the corresponding product decision.
--
-- Deletion policy: purchase, progress and audit history are never cascade
-- deleted (ON DELETE RESTRICT / SET NULL where a nullable actor reference is
-- required). Structural children (modules → lessons) cascade so that removing
-- course structure works while history tables block destructive removal.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  password_algorithm TEXT NOT NULL DEFAULT 'argon2id'
                     CHECK (password_algorithm IN ('argon2id')),
  name               TEXT NOT NULL
                     CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended')),
  email_verified_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Email is stored normalised (lowercase) and validated again server-side;
  -- the CHECK is the last line of defence.
  CONSTRAINT users_email_normalized
    CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE roles (
  key         TEXT PRIMARY KEY CHECK (key IN ('student', 'instructor', 'admin')),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  key         TEXT PRIMARY KEY
              CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  description TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_key       TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE user_roles (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key   TEXT NOT NULL REFERENCES roles(key) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_key)
);
CREATE INDEX user_roles_role_key_idx ON user_roles(role_key);

CREATE TABLE sessions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash          TEXT NOT NULL UNIQUE,
  previous_refresh_token_hash TEXT UNIQUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                  TIMESTAMPTZ NOT NULL,
  rotated_at                  TIMESTAMPTZ,
  revoked_at                  TIMESTAMPTZ,
  revoked_reason              TEXT
                              CHECK (revoked_reason IS NULL
                                     OR revoked_reason IN ('logout', 'reuse_detected', 'admin_revoked')),
  last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent                  TEXT,
  ip_address                  TEXT,
  -- Revocation must record when and why; a reason without a timestamp (or the
  -- reverse) is never written.
  CONSTRAINT sessions_revocation_metadata
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Course management
-- ---------------------------------------------------------------------------
CREATE TABLE courses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE
               CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 120),
  title        TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  summary      TEXT CHECK (summary IS NULL OR length(summary) <= 500),
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'in_review', 'published',
                                 'withdrawal_scheduled', 'withdrawn')),
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT courses_published_requires_timestamp
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX courses_status_idx ON courses(status);
CREATE INDEX courses_created_by_idx ON courses(created_by);

CREATE TABLE modules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title      TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  position   INTEGER NOT NULL CHECK (position >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT modules_unique_position UNIQUE (course_id, position)
);
CREATE INDEX modules_course_id_idx ON modules(course_id);

CREATE TABLE lessons (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id        UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  position         INTEGER NOT NULL CHECK (position >= 1),
  duration_seconds NUMERIC(10, 2)
                   CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lessons_unique_position UNIQUE (module_id, position)
);
CREATE INDEX lessons_module_id_idx ON lessons(module_id);

-- ---------------------------------------------------------------------------
-- Access — entitlement is the authority for access; enrolment records the
-- learner's participation. A payment row alone must never grant access.
-- ---------------------------------------------------------------------------
CREATE TABLE enrollments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'completed')),
  enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enrollments_unique_user_course UNIQUE (user_id, course_id),
  CONSTRAINT enrollments_completed_requires_timestamp
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX enrollments_user_id_idx ON enrollments(user_id);
CREATE INDEX enrollments_course_id_idx ON enrollments(course_id);

-- ---------------------------------------------------------------------------
-- Commerce (transactions). Order/payment/entitlement are separate concepts;
-- a verified successful payment creates the entitlement (Phase 4 wires this).
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'created'
                  CHECK (status IN ('created', 'payment_pending', 'paid', 'failed',
                                    'cancelled', 'partially_refunded', 'refunded', 'reversed')),
  currency        TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_amount    NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_id_idx ON orders(user_id);
CREATE INDEX orders_status_idx ON orders(status);

CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  title_snapshot  TEXT NOT NULL CHECK (length(btrim(title_snapshot)) BETWEEN 1 AND 160),
  unit_amount     NUMERIC(12, 2) NOT NULL CHECK (unit_amount >= 0),
  quantity        INTEGER NOT NULL CHECK (quantity >= 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bundles are an open decision (O-18); unique lines keep Phase 1 honest.
  CONSTRAINT order_items_unique_course UNIQUE (order_id, course_id)
);
CREATE INDEX order_items_order_id_idx ON order_items(order_id);

CREATE TABLE payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider           TEXT NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 64),
  provider_reference TEXT,
  status             TEXT NOT NULL
                     CHECK (status IN ('initiated', 'pending', 'succeeded', 'failed',
                                       'expired', 'reversed', 'refunded')),
  amount             NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency           TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Unique provider payment references (domain-model data integrity requirement).
CREATE UNIQUE INDEX payments_provider_reference_uidx
  ON payments(provider, provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX payments_order_id_idx ON payments(order_id);

-- Webhook receipts: unique event identity gives idempotent processing.
CREATE TABLE payment_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 64),
  event_id     TEXT NOT NULL CHECK (length(btrim(event_id)) BETWEEN 1 AND 255),
  event_type   TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'received'
               CHECK (status IN ('received', 'processed', 'ignored', 'quarantined')),
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT payment_events_unique_event UNIQUE (provider, event_id)
);

CREATE TABLE entitlements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id             UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  source                TEXT NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 64),
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'revoked')),
  granted_by_payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT,
  granted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  revoked_reason        TEXT,
  revoked_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_unique_user_course UNIQUE (user_id, course_id),
  -- Business rule: revocation requires reason + timestamp (actor/source is
  -- recorded in revoked_by and the audit log).
  CONSTRAINT entitlements_revocation_requires_reason_and_time
    CHECK (status <> 'revoked'
           OR (revoked_at IS NOT NULL AND btrim(coalesce(revoked_reason, '')) <> ''))
);
CREATE INDEX entitlements_user_id_idx ON entitlements(user_id);
CREATE INDEX entitlements_course_id_idx ON entitlements(course_id);
CREATE INDEX entitlements_active_uidx ON entitlements(user_id, course_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Learning — progress is independent from downloads (Phase 6 adds downloads).
-- ---------------------------------------------------------------------------
CREATE TABLE lesson_progress (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  lesson_id                 UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  enrollment_id             UUID REFERENCES enrollments(id) ON DELETE RESTRICT,
  status                    TEXT NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started', 'in_progress', 'completed')),
  progress_percent          NUMERIC(5, 2) NOT NULL DEFAULT 0
                            CHECK (progress_percent >= 0 AND progress_percent <= 100),
  playback_position_seconds NUMERIC(10, 2)
                            CHECK (playback_position_seconds IS NULL
                                   OR playback_position_seconds >= 0),
  completed_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_progress_unique_user_lesson UNIQUE (user_id, lesson_id),
  CONSTRAINT lesson_progress_completed_requires_timestamp
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX lesson_progress_user_id_idx ON lesson_progress(user_id);
CREATE INDEX lesson_progress_lesson_id_idx ON lesson_progress(lesson_id);
CREATE INDEX lesson_progress_enrollment_id_idx ON lesson_progress(enrollment_id);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 120),
  target_type   TEXT CHECK (target_type IS NULL OR length(btrim(target_type)) BETWEEN 1 AND 64),
  target_id     TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_created_at_idx ON audit_events(created_at DESC);
CREATE INDEX audit_events_actor_user_id_idx ON audit_events(actor_user_id);
CREATE INDEX audit_events_action_idx ON audit_events(action);
CREATE INDEX audit_events_target_idx ON audit_events(target_type, target_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance (single definition, one trigger per table)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER courses_set_updated_at BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER modules_set_updated_at BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lessons_set_updated_at BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER enrollments_set_updated_at BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER entitlements_set_updated_at BEFORE UPDATE ON entitlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lesson_progress_set_updated_at BEFORE UPDATE ON lesson_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
