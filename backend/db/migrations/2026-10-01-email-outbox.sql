-- ============================================================
-- MITEX email outbox (persisted send queue + status tracking)
-- Run this in your Supabase SQL editor (Postgres).
-- ============================================================

CREATE TABLE IF NOT EXISTS email_sends (
  id            BIGSERIAL PRIMARY KEY,
  to_addr       TEXT NOT NULL,
  subject       TEXT NOT NULL,
  kind          TEXT,
  body          TEXT,
  html_body     TEXT,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sending','sent','failed','dropped')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  message_id    TEXT,
  last_error    TEXT,
  dev           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_sends_status_idx ON email_sends (status, next_retry_at);
CREATE INDEX IF NOT EXISTS email_sends_created_idx ON email_sends (created_at DESC);