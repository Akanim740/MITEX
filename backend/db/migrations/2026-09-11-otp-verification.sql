-- Adds OTP email verification to account registration/verification.
-- Run after 2026-08-28-not-ready-delivery.sql.
--
-- The tokens.type CHECK ignored 'verify_otp'; relax it so the OTP codes
-- issued at registration can be stored. The migration must match the
-- actual constraint name on Postgres (PostgREST/Supabase auto-names
-- table-level CHECK constraints as <table>_<column>_check).
--
-- If the constraint name differs, run:
--   ALTER TABLE tokens DROP CONSTRAINT <actual_name>;
-- then re-run the ALTER TABLE ... ADD CONSTRAINT below.

ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_type_check;
ALTER TABLE tokens ADD CONSTRAINT tokens_type_check CHECK (type IN ('verify','reset','verify_otp'));

-- Refresh the PostgREST schema cache so the new enum is visible.
NOTIFY pgrst, 'reload schema';