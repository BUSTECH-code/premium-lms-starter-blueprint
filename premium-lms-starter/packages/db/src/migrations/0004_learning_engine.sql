-- =============================================================================
-- 0004_learning_engine.sql — Phase 3: learning & progress engine
--
-- Approved product decisions (product owner, 2026-11-05):
--   Q1 local_authorized_fixtures : lesson kinds video | text | quiz | download;
--       development-fixture media is delivered only through a short-lived,
--       backend-authorized, scoped grant. Private Google Drive remains a
--       documented provider seam; no public links or client-visible credentials.
--   Q2 sequential_explicit       : every lesson is required in module/lesson
--       order; video/text/download complete only by an explicit action; quiz
--       lessons complete by passing; a lesson unlocks only after all earlier
--       lessons are completed.
--   Q3 pass80_unlimited_best     : objective auto-grading, >=80% passes,
--       unlimited attempts, best score per quiz + course average of best scores.
--   Q4 frozen_no_certificate     : completion criteria are versioned and frozen
--       on the enrolment; course completion and gradebook are recorded, but NO
--       certificate is issued (design/verification remains open).
--
-- History policy: progress, attempts, gradebook, completion and audit records
-- are never cascade-deleted from a learner.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Lesson kinds and completion criteria
-- ---------------------------------------------------------------------------
ALTER TABLE lessons
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'video'
  CHECK (kind IN ('video', 'text', 'quiz', 'download'));

CREATE TABLE course_completion_rules (
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL CHECK (version >= 1),
  criteria   JSONB NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, version),
  CONSTRAINT course_completion_rules_shape CHECK (
    jsonb_typeof(criteria) = 'object'
    AND (criteria->>'policy') = 'all_required_lessons'
    AND (criteria->>'lessonOrder') = 'module_position_then_lesson_position'
    AND (criteria->>'videoCompletion') = 'explicit'
    AND jsonb_typeof(criteria->'quizPassingScorePercent') = 'number'
    AND (criteria->>'quizPassingScorePercent')::int BETWEEN 1 AND 100
  )
);
CREATE UNIQUE INDEX course_completion_rules_one_active_uidx
  ON course_completion_rules(course_id) WHERE is_active;

-- Approved platform default, version 1. Criteria are JSONB so a future,
-- approved rule change can be added as a new version without mutating history.
INSERT INTO course_completion_rules (course_id, version, criteria, is_active)
SELECT id, 1,
       jsonb_build_object(
         'policy', 'all_required_lessons',
         'lessonOrder', 'module_position_then_lesson_position',
         'videoCompletion', 'explicit',
         'quizPassingScorePercent', 80
       ),
       true
  FROM courses
ON CONFLICT (course_id, version) DO NOTHING;

-- Every course always has at least one completion-rule version.
CREATE OR REPLACE FUNCTION ensure_course_completion_rules() RETURNS trigger AS $$
BEGIN
  INSERT INTO course_completion_rules (course_id, version, criteria, is_active)
  VALUES (NEW.id, 1,
          jsonb_build_object(
            'policy', 'all_required_lessons',
            'lessonOrder', 'module_position_then_lesson_position',
            'videoCompletion', 'explicit',
            'quizPassingScorePercent', 80
          ), true)
  ON CONFLICT (course_id, version) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER courses_ensure_completion_rules
  AFTER INSERT ON courses
  FOR EACH ROW EXECUTE FUNCTION ensure_course_completion_rules();

-- Enrolment freezes the active rule version at the moment of enrolment. A later
-- approved rule change creates version 2 and affects only new enrolments.
ALTER TABLE enrollments ADD COLUMN criteria_version INTEGER NOT NULL DEFAULT 1;
UPDATE enrollments e
   SET criteria_version = r.version
  FROM course_completion_rules r
 WHERE r.course_id = e.course_id AND r.is_active = true;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_completion_rules_fk
  FOREIGN KEY (course_id, criteria_version)
  REFERENCES course_completion_rules(course_id, version) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION freeze_enrollment_criteria() RETURNS trigger AS $$
DECLARE active_version INTEGER;
BEGIN
  SELECT version INTO active_version
    FROM course_completion_rules
   WHERE course_id = NEW.course_id AND is_active = true;
  IF active_version IS NULL THEN
    RAISE EXCEPTION 'No active completion rules for course %', NEW.course_id;
  END IF;
  NEW.criteria_version := active_version;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER enrollments_freeze_criteria
  BEFORE INSERT ON enrollments
  FOR EACH ROW EXECUTE FUNCTION freeze_enrollment_criteria();

-- Course completion state (proposed state model: Not Eligible / In Progress /
-- Completed / Certificate Issued). `certificate_issued` is a permitted value
-- only; Phase 3 deliberately never writes it (Q4).
CREATE TABLE course_completion (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  criteria_version INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('not_eligible', 'in_progress', 'completed', 'certificate_issued')),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT course_completion_unique_user_course UNIQUE (user_id, course_id),
  CONSTRAINT course_completion_rules_fk
    FOREIGN KEY (course_id, criteria_version)
    REFERENCES course_completion_rules(course_id, version) ON DELETE RESTRICT,
  CONSTRAINT course_completion_consistent CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);
CREATE INDEX course_completion_course_id_idx ON course_completion(course_id);
CREATE TRIGGER course_completion_set_updated_at BEFORE UPDATE ON course_completion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Preserve completion history for enrolments that already existed before this
-- migration, and create the state row for every future enrolment.
INSERT INTO course_completion (user_id, course_id, criteria_version, status, completed_at)
SELECT user_id, course_id, criteria_version,
       CASE WHEN status = 'completed' THEN 'completed' ELSE 'in_progress' END,
       completed_at
  FROM enrollments
ON CONFLICT (user_id, course_id) DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_course_completion() RETURNS trigger AS $$
BEGIN
  INSERT INTO course_completion (user_id, course_id, criteria_version, status)
  VALUES (NEW.user_id, NEW.course_id, NEW.criteria_version, 'in_progress')
  ON CONFLICT (user_id, course_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER enrollments_ensure_completion
  AFTER INSERT ON enrollments
  FOR EACH ROW EXECUTE FUNCTION ensure_course_completion();

-- ---------------------------------------------------------------------------
-- Media assets and lesson content
-- `provider_reference` is a PRIVATE reference (local fixture basename or Drive
-- file ID). It is never serialised to the browser.
-- ---------------------------------------------------------------------------
CREATE TABLE media_assets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           TEXT NOT NULL CHECK (provider IN ('local_fixture', 'google_drive')),
  provider_reference TEXT NOT NULL CHECK (length(btrim(provider_reference)) BETWEEN 1 AND 512),
  mime_type          TEXT NOT NULL CHECK (mime_type ~ '^[a-z0-9]+/[A-Za-z0-9.+_-]+$'),
  file_name          TEXT NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  file_size_bytes    BIGINT NOT NULL CHECK (file_size_bytes >= 0),
  checksum_sha256    TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  duration_seconds   NUMERIC(10, 2) CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_unique_reference UNIQUE (provider, provider_reference, version)
);
CREATE TRIGGER media_assets_set_updated_at BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE lesson_content (
  lesson_id  UUID PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  body_text  TEXT,
  asset_id   UUID REFERENCES media_assets(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_content_body_not_blank
    CHECK (body_text IS NULL OR length(btrim(body_text)) > 0),
  CONSTRAINT lesson_content_asset_or_body CHECK (asset_id IS NULL OR body_text IS NULL)
);
CREATE TRIGGER lesson_content_set_updated_at BEFORE UPDATE ON lesson_content
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION validate_lesson_content() RETURNS trigger AS $$
DECLARE lesson_kind TEXT;
BEGIN
  SELECT kind INTO lesson_kind FROM lessons WHERE id = NEW.lesson_id;
  IF lesson_kind IN ('video', 'download') AND NEW.asset_id IS NULL THEN
    RAISE EXCEPTION 'A % lesson requires a media asset', lesson_kind;
  END IF;
  IF lesson_kind = 'text' AND NEW.body_text IS NULL THEN
    RAISE EXCEPTION 'A text lesson requires body content';
  END IF;
  IF lesson_kind = 'quiz' AND NEW.asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'A quiz lesson cannot reference a media asset';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER lesson_content_validate
  BEFORE INSERT OR UPDATE ON lesson_content
  FOR EACH ROW EXECUTE FUNCTION validate_lesson_content();

CREATE OR REPLACE FUNCTION validate_lesson_kind_change() RETURNS trigger AS $$
BEGIN
  IF NEW.kind <> OLD.kind AND EXISTS (
    SELECT 1 FROM lesson_content WHERE lesson_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Cannot change lesson kind after content exists';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER lessons_validate_kind_change
  BEFORE UPDATE OF kind ON lessons
  FOR EACH ROW EXECUTE FUNCTION validate_lesson_kind_change();

-- Short-lived, scoped, opaque delivery authorization. Only a SHA-256 hash of
-- the token is stored; the raw token never appears in logs or error messages.
CREATE TABLE media_asset_grants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id  UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  asset_id   UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('stream', 'download')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_asset_grants_future_expiry CHECK (expires_at > created_at)
);
CREATE INDEX media_asset_grants_expiry_idx ON media_asset_grants(expires_at);
CREATE INDEX media_asset_grants_user_idx ON media_asset_grants(user_id);

-- ---------------------------------------------------------------------------
-- Assessments and gradebook (objective questions only)
-- Correct answers live in quiz_questions.choices and are NEVER sent to clients.
-- ---------------------------------------------------------------------------
CREATE TABLE quizzes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id    UUID NOT NULL UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  instructions TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER quizzes_set_updated_at BEFORE UPDATE ON quizzes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE quiz_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id    UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL CHECK (position >= 1),
  kind       TEXT NOT NULL CHECK (kind IN ('single_choice', 'multiple_choice', 'true_false')),
  prompt     TEXT NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 1000),
  points     INTEGER NOT NULL DEFAULT 1 CHECK (points >= 1),
  choices    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quiz_questions_unique_position UNIQUE (quiz_id, position)
);
CREATE INDEX quiz_questions_quiz_id_idx ON quiz_questions(quiz_id);

CREATE OR REPLACE FUNCTION validate_quiz_choices() RETURNS trigger AS $$
DECLARE correct_count INTEGER;
BEGIN
  IF jsonb_typeof(NEW.choices) <> 'array' OR jsonb_array_length(NEW.choices) < 2 THEN
    RAISE EXCEPTION 'Quiz choices must be an array with at least two options';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.choices) AS elem(value)
     WHERE jsonb_typeof(elem.value) <> 'object'
        OR NOT (elem.value ? 'id' AND elem.value ? 'text' AND elem.value ? 'isCorrect')
        OR jsonb_typeof(elem.value->'isCorrect') <> 'boolean'
        OR length(btrim(elem.value->>'text')) = 0
        OR length(btrim(elem.value->>'id')) = 0
  ) THEN
    RAISE EXCEPTION 'Each quiz choice needs id, text and boolean isCorrect';
  END IF;
  SELECT count(*) INTO correct_count
    FROM jsonb_array_elements(NEW.choices) AS elem(value)
   WHERE (elem.value->>'isCorrect')::boolean = true;
  IF correct_count < 1 THEN
    RAISE EXCEPTION 'A quiz question needs at least one correct choice';
  END IF;
  IF NEW.kind IN ('single_choice', 'true_false') AND correct_count <> 1 THEN
    RAISE EXCEPTION 'A % question needs exactly one correct choice', NEW.kind;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER quiz_questions_validate
  BEFORE INSERT OR UPDATE ON quiz_questions
  FOR EACH ROW EXECUTE FUNCTION validate_quiz_choices();

CREATE TABLE quiz_attempts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id              UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  quiz_id                UUID NOT NULL REFERENCES quizzes(id) ON DELETE RESTRICT,
  lesson_id              UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  enrollment_id          UUID REFERENCES enrollments(id) ON DELETE RESTRICT,
  criteria_version       INTEGER NOT NULL,
  attempt_no             INTEGER NOT NULL CHECK (attempt_no >= 1),
  client_submission_id   TEXT NOT NULL CHECK (length(btrim(client_submission_id)) BETWEEN 1 AND 120),
  answers                JSONB NOT NULL DEFAULT '{}'::jsonb,
  points_earned          NUMERIC(8, 2) NOT NULL CHECK (points_earned >= 0),
  points_possible        NUMERIC(8, 2) NOT NULL CHECK (points_possible > 0),
  score_percent          NUMERIC(5, 2) NOT NULL CHECK (score_percent >= 0 AND score_percent <= 100),
  passing_score_percent  INTEGER NOT NULL CHECK (passing_score_percent BETWEEN 1 AND 100),
  passed                 BOOLEAN NOT NULL,
  submitted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quiz_attempts_unique_client_submission UNIQUE (user_id, client_submission_id),
  CONSTRAINT quiz_attempts_unique_attempt UNIQUE (user_id, quiz_id, attempt_no),
  CONSTRAINT quiz_attempts_rules_fk
    FOREIGN KEY (course_id, criteria_version)
    REFERENCES course_completion_rules(course_id, version) ON DELETE RESTRICT
);
CREATE INDEX quiz_attempts_user_course_idx ON quiz_attempts(user_id, course_id);
CREATE INDEX quiz_attempts_quiz_idx ON quiz_attempts(quiz_id);

CREATE TABLE quiz_gradebook (
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  quiz_id             UUID NOT NULL REFERENCES quizzes(id) ON DELETE RESTRICT,
  lesson_id           UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  course_id           UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  best_score_percent  NUMERIC(5, 2) NOT NULL CHECK (best_score_percent >= 0 AND best_score_percent <= 100),
  latest_score_percent NUMERIC(5, 2) NOT NULL CHECK (latest_score_percent >= 0 AND latest_score_percent <= 100),
  best_attempt_id     UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE RESTRICT,
  latest_attempt_id   UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE RESTRICT,
  attempt_count       INTEGER NOT NULL CHECK (attempt_count >= 1),
  passed              BOOLEAN NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quiz_id)
);
CREATE INDEX quiz_gradebook_user_course_idx ON quiz_gradebook(user_id, course_id);
CREATE TRIGGER quiz_gradebook_set_updated_at BEFORE UPDATE ON quiz_gradebook
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE course_gradebook (
  user_id                    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id                  UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  quiz_count                 INTEGER NOT NULL DEFAULT 0 CHECK (quiz_count >= 0),
  graded_quiz_count          INTEGER NOT NULL DEFAULT 0 CHECK (graded_quiz_count >= 0),
  attempt_count              INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  average_best_score_percent NUMERIC(5, 2) CHECK (average_best_score_percent IS NULL OR average_best_score_percent BETWEEN 0 AND 100),
  latest_score_percent       NUMERIC(5, 2) CHECK (latest_score_percent IS NULL OR latest_score_percent BETWEEN 0 AND 100),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
CREATE TRIGGER course_gradebook_set_updated_at BEFORE UPDATE ON course_gradebook
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Progress state machine support
-- `revision` is an optimistic concurrency counter. `progress_events` gives
-- exact-once processing of client events (rapid clicks / offline retries).
-- `progress_client_sequences` defines the stale-client conflict rule per device.
-- Client wall-clock time is stored for evidence but NEVER used for ordering.
-- ---------------------------------------------------------------------------
ALTER TABLE lesson_progress ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lesson_progress ADD COLUMN completion_source TEXT
  CHECK (completion_source IS NULL OR completion_source IN ('explicit', 'quiz_pass'));
ALTER TABLE lesson_progress ADD COLUMN last_event_at TIMESTAMPTZ;

UPDATE lesson_progress
   SET progress_percent = 100,
       completion_source = 'explicit'
 WHERE status = 'completed';
UPDATE lesson_progress
   SET completed_at = NULL, completion_source = NULL
 WHERE status <> 'completed';
ALTER TABLE lesson_progress
  ADD CONSTRAINT lesson_progress_completion_consistent CHECK (
    (status = 'completed'
      AND completed_at IS NOT NULL
      AND completion_source IS NOT NULL
      AND progress_percent = 100)
    OR (status <> 'completed'
      AND completed_at IS NULL
      AND completion_source IS NULL)
  );

CREATE TABLE progress_client_sequences (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id     UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL CHECK (length(btrim(client_id)) BETWEEN 1 AND 80),
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id, client_id)
);

CREATE TABLE progress_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  lesson_id        UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  enrollment_id    UUID REFERENCES enrollments(id) ON DELETE RESTRICT,
  client_id        TEXT NOT NULL CHECK (length(btrim(client_id)) BETWEEN 1 AND 80),
  client_event_id  TEXT NOT NULL CHECK (length(btrim(client_event_id)) BETWEEN 1 AND 120),
  sequence         BIGINT NOT NULL CHECK (sequence >= 1),
  event_type       TEXT NOT NULL CHECK (event_type IN ('start', 'position', 'complete', 'quiz_passed')),
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome          TEXT NOT NULL
                   CHECK (outcome IN ('applied', 'duplicate', 'stale', 'ignored', 'rejected')),
  result           JSONB NOT NULL,
  server_revision  INTEGER NOT NULL,
  CONSTRAINT progress_events_unique_client_event UNIQUE (user_id, client_event_id)
);
CREATE INDEX progress_events_user_lesson_idx ON progress_events(user_id, lesson_id, received_at);
CREATE INDEX progress_events_lesson_idx ON progress_events(lesson_id);
