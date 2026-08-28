-- =====================================================================
-- MITEX production (Supabase) migration
-- Date: 2026-08-28
-- Purpose:
--   1) Fixes the PROD OUTAGE (registration/apply 500s) caused by columns
--      missing from the old Supabase schema.
--      Missing: users.dob/nin_bvn/nin_file/payment_enc,
--               applications.dob/nin_bvn, orders.notes
--   2) Adds the "not-ready delivery" feature tables:
--      buy_intents, push_subscriptions, notifications
-- How to run: Supabase Dashboard -> SQL Editor -> New query -> paste ->
--             Run. Then re-run the two commands under "After running"
--             if the PostgREST schema cache did not reload automatically.
-- =====================================================================

-- ---- 1. Fix the missing user columns (register 500) ----
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dob TEXT,
  ADD COLUMN IF NOT EXISTS nin_bvn TEXT,
  ADD COLUMN IF NOT EXISTS nin_file TEXT,
  ADD COLUMN IF NOT EXISTS payment_enc TEXT;

-- ---- 2. Fix the missing application columns (apply 500) ----
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS dob TEXT,
  ADD COLUMN IF NOT EXISTS nin_bvn TEXT;

-- ---- 3. Fix the missing order column (checkout notes) ----
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- ---- 4. New table: buy_intents (buyer confirmed intent, not yet paid) ----
CREATE TABLE IF NOT EXISTS buy_intents (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id BIGINT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','ready','purchased','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (user_id, listing_id)
);
ALTER TABLE buy_intents ENABLE ROW LEVEL SECURITY;

-- ---- 5. New table: push_subscriptions (Web Push devices) ----
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ---- 6. New table: notifications (in-app) ----
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ---- 7. Reload the PostgREST schema cache ----
NOTIFY pgrst, 'reload schema';