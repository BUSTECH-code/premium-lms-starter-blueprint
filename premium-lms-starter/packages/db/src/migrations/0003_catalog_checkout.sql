-- =============================================================================
-- 0003_catalog_checkout.sql — Phase 2: catalogue, pricing, checkout
--
-- Adds: instructor bio, course pricing, categories/tags for discovery,
-- and order checkout expiry (abandoned-checkout handling).
-- No existing column semantics change; history tables untouched.
-- =============================================================================

-- Instructor attribution/bio for course pages (bio optional — never invented).
ALTER TABLE users
  ADD COLUMN bio TEXT
  CHECK (bio IS NULL OR length(bio) <= 2000);

-- Course pricing. The server is the authority for price at order creation;
-- clients never supply amounts. Backfill uses the development placeholder
-- currency (see O-05/O-21: provider and currency decisions remain OPEN);
-- application code always supplies the value explicitly.
ALTER TABLE courses ADD COLUMN price_amount NUMERIC(12, 2);
ALTER TABLE courses ADD COLUMN price_currency TEXT;
UPDATE courses
   SET price_amount = 0,
       price_currency = 'NGN'
 WHERE price_amount IS NULL OR price_currency IS NULL;
ALTER TABLE courses
  ALTER COLUMN price_amount SET NOT NULL;
ALTER TABLE courses
  ADD CONSTRAINT courses_price_amount_non_negative CHECK (price_amount >= 0);
ALTER TABLE courses
  ALTER COLUMN price_currency SET NOT NULL;
ALTER TABLE courses
  ADD CONSTRAINT courses_price_currency_format CHECK (price_currency ~ '^[A-Z]{3}$');

-- Discovery: category taxonomy mechanism + free-form tags.
-- The taxonomy contents are a product decision (open — requirements.md);
-- tables provide the mechanism only and are populated by fixtures/admin data.
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE
              CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 60),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE course_categories (
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (course_id, category_id)
);
CREATE INDEX course_categories_category_id_idx ON course_categories(category_id);

ALTER TABLE courses
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX courses_tags_idx ON courses USING GIN (tags);

-- Abandoned checkout: each order carries its checkout deadline.
ALTER TABLE orders ADD COLUMN expires_at TIMESTAMPTZ;
CREATE INDEX orders_checkout_expiry_idx ON orders(expires_at)
  WHERE status = 'created' OR status = 'payment_pending';
