-- =====================================================================
-- MITEX production (Supabase) migration
-- Date: 2026-10-02
-- Purpose: Add listings.category so the marketplace can be browsed by what
--          a buyer is actually shopping for.
--
-- Why: listings only ever had asset_type ("website" | "business"), which
-- splits the catalogue by legal shape, not by purpose. A buyer looking for
-- "an online store" or "a school portal" had no way to express that, so
-- neither the marketplace UI nor SEO could segment the inventory.
--
-- The slug vocabulary is owned by backend/utils/categories.js. This column is
-- deliberately a plain VARCHAR rather than an ENUM/CHECK: the category set is
-- owned by application code and will grow, and re-running this file after a
-- new category ships must not require an ALTER TYPE. Writes are validated
-- against the canonical list in routes/listings.js, and a value outside it is
-- rejected with a 400 rather than stored.
--
-- Existing rows default to 'other'. That is a deliberate, honest default: a
-- listing with no category is not evidence of any particular industry. Set the
-- real value per listing from the admin form (dashboard -> listings).
--
-- Safe to run more than once.
-- How to run: Supabase Dashboard -> SQL Editor -> New query -> paste ->
--             Run.
-- =====================================================================

-- ---- 1. Add the category column ----
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';

-- ---- 2. Index it: every category-filtered marketplace query filters on it ----
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings (category);

-- ---- 3. Reload the PostgREST schema cache ----
-- db/supabase.js probes for this column at boot and strips it from writes
-- until the schema cache exposes it, so a stale cache degrades the feature
-- instead of 500ing.
NOTIFY pgrst, 'reload schema';