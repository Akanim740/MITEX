-- ============================================================
-- MITEX database schema - Supabase (PostgreSQL)
-- Paste ALL of this into the Supabase SQL Editor and click RUN.
-- ONLY for a brand-new/empty database!
--
-- If your tables already exist, do NOT run this file.
-- Instead scroll to the UPGRADES section at the bottom and run
-- only the lines you are missing.
-- ============================================================

CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','editor','staff','customer')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone          TEXT,
  bio            TEXT,
  avatar_url     TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  country        TEXT NOT NULL DEFAULT 'NG',
  locale         TEXT NOT NULL DEFAULT 'en',
  created_at     TEXT NOT NULL,
  updated_at     TEXT
);

CREATE TABLE tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL CHECK (type IN ('verify','reset')),
  expires_at TEXT NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE enquiries (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT,
  intent     TEXT CHECK (intent IN ('buy','sell')),
  level      SMALLINT CHECK (level BETWEEN 1 AND 7),
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at TEXT NOT NULL
);

CREATE TABLE listings (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  level       SMALLINT CHECK (level BETWEEN 1 AND 7),
  tech_stack  TEXT,
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold')),
  thumbnail   TEXT,
  delivery_url TEXT,
  employee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE subscribers (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL
);

CREATE TABLE orders (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  listing_id BIGINT,
  reference  TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency   TEXT NOT NULL DEFAULT 'NGN',
  email      TEXT NOT NULL,
  name       TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  paid_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE webauthn_credentials (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  device_type   TEXT,
  backed_up     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TEXT NOT NULL
);

CREATE TABLE applications (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  portfolio         TEXT,
  message           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','test_sent','submitted','passed','rejected')),
  test_token        TEXT UNIQUE,
  test_instructions TEXT,
  test_sent_at      TEXT,
  submit_url        TEXT,
  submit_notes      TEXT,
  submitted_at      TEXT,
  staff_user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  hire_token        TEXT UNIQUE,
  hire_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  payment_enc       TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE salaries (
  id            BIGSERIAL PRIMARY KEY,
  staff_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  bonus         BIGINT NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  period        TEXT NOT NULL,
  note          TEXT,
  paid_at       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ============================================================
-- UPGRADES (run only the lines you are missing, one at a time)
-- ============================================================
-- ALTER TABLE listings ADD COLUMN IF NOT EXISTS delivery_url TEXT;
-- ALTER TABLE listings ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'NG';
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';
--
-- Recruitment pipeline: applications table for job applicants.
-- CREATE TABLE applications (
--   id                BIGSERIAL PRIMARY KEY,
--   name              TEXT NOT NULL,
--   email             TEXT NOT NULL,
--   phone             TEXT,
--   portfolio         TEXT,
--   message           TEXT NOT NULL,
--   status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','test_sent','submitted','passed','rejected')),
--   test_token        TEXT UNIQUE,
--   test_instructions TEXT,
--   test_sent_at      TEXT,
--   submit_url        TEXT,
--   submit_notes      TEXT,
--   submitted_at      TEXT,
--   staff_user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
--   hire_token        TEXT UNIQUE,
--   hire_completed    BOOLEAN NOT NULL DEFAULT FALSE,
--   created_at        TEXT NOT NULL
-- );
--
-- Salary ledger for employee payments.
-- CREATE TABLE salaries (
--   id            BIGSERIAL PRIMARY KEY,
--   staff_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
--   amount        BIGINT NOT NULL CHECK (amount > 0),
--   bonus         BIGINT NOT NULL DEFAULT 0 CHECK (bonus >= 0),
--   period        TEXT NOT NULL,
--   note          TEXT,
--   paid_at       TEXT NOT NULL,
--   created_at    TEXT NOT NULL
-- );
--
-- Encrypted applicant payment details (auto-hire pipeline).
-- ALTER TABLE applications ADD COLUMN IF NOT EXISTS payment_enc TEXT;
--
-- Employees feature: allow role 'staff' on existing databases.
-- The CHECK constraint on users.role must be replaced:
--   ALTER TABLE users DROP CONSTRAINT users_role_check;
--   ALTER TABLE users ADD CONSTRAINT users_role_check
--     CHECK (role IN ('admin','editor','staff','customer'));
-- (If that DROP errors, find the exact name first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c';
--  then drop/add using that name.)
