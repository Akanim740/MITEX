-- ============================================================
-- MITEX database schema - Supabase (PostgreSQL)
-- Paste ALL of this into the Supabase SQL Editor and click RUN.
-- ONLY for a brand-new/empty database!
--
-- If your tables already exist, do NOT run this file.
-- Instead just run any missing upgrade lines, e.g.:
--   ALTER TABLE listings ADD COLUMN IF NOT EXISTS delivery_url TEXT;
-- ============================================================

CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','editor','customer')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone          TEXT,
  bio            TEXT,
  avatar_url     TEXT,
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
