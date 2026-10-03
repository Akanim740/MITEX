-- =====================================================================
-- MITEX production (Supabase) migration
-- Date: 2026-10-02
-- Purpose: Add listings.updated_at so sitemap <lastmod> reports real edits.
--
-- Why: routes/seo.js has always read (row.updated_at || row.created_at) for
-- each sitemap entry, but listings never had an updated_at column, so the
-- fallback always won. Every listing page reported its creation date forever,
-- even after an admin corrected the title, changed the price, marked it sold
-- or added a demo URL. Google uses lastmod to decide how often to recrawl, so
-- a permanently stale value means edited pages get crawled on the original
-- schedule rather than when the content actually changed -- and an
-- inaccurate lastmod is a crawl-quality signal we should not be sending.
--
-- NULLABLE on purpose, and no DB-level trigger. The application stamps the
-- column on every create and update (all four adapters in db/), so "when did
-- this listing last change" has exactly one definition and cannot drift
-- between a trigger and the write path. A trigger would also fire on
-- unrelated column churn and make the timestamp hard to reason about when
-- debugging a listing.
--
-- Step 3 backfills existing rows from created_at. That is the truthful value:
-- for a listing nobody has edited, creation time genuinely is the last
-- modification time. Backfilling rather than leaving NULL means the sitemap
-- keeps a valid lastmod instead of omitting the tag.
--
-- Safe to run more than once.
-- How to run: Supabase Dashboard -> SQL Editor -> New query -> paste ->
--             Run.
-- =====================================================================

-- ---- 1. Add the column ----
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS updated_at TEXT;

-- ---- 2. Backfill from created_at so existing rows have a truthful lastmod ----
UPDATE listings
   SET updated_at = created_at
 WHERE updated_at IS NULL
    OR updated_at = '';

-- ---- 3. Reload the PostgREST schema cache ----
-- db/supabase.js probes for this column at boot and stops stamping it until
-- the schema cache exposes it. lastmodOf falls back to created_at meanwhile,
-- so the sitemap stays valid rather than losing lastmod entirely.
NOTIFY pgrst, 'reload schema';