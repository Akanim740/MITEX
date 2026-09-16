-- =====================================================================
-- MITEX production (Supabase) migration
-- Date: 2026-09-15
-- Purpose:
--   Adds the admin-managed Website Packages table. Packages are seeded
--   from the app on boot (SEED_ON_BOOT/seed script) and edited from the
--   Admin Dashboard -> Packages view.
-- How to run: Supabase Dashboard -> SQL Editor -> New query -> paste ->
--             Run. Then re-run `NOTIFY pgrst, 'reload schema';` if the
--             PostgREST schema cache did not reload automatically.
-- =====================================================================

-- ---- 1. New table: packages (website package tiers) ----
CREATE TABLE IF NOT EXISTS packages (
  id         BIGSERIAL PRIMARY KEY,
  pkg_key    TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  code       TEXT,
  tagline    TEXT,
  price      NUMERIC(14,2),
  pages      TEXT,
  delivery   TEXT,
  support    TEXT,
  popular    BOOLEAN NOT NULL DEFAULT FALSE,
  features   TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;

-- ---- 2. Reload the PostgREST schema cache ----
NOTIFY pgrst, 'reload schema';