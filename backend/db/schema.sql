-- ============================================================
-- MITEX database schema
-- SQLite is created automatically by the app (db/sqlite.js).
-- Use the sections below for MySQL or Supabase (Postgres).
-- MongoDB / Firebase are schemaless - no setup needed.
-- ============================================================

-- ---------- MySQL ----------
-- CREATE DATABASE IF NOT EXISTS mitex CHARACTER SET utf8mb4;
-- USE mitex;

CREATE TABLE users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  email          VARCHAR(190) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  role           ENUM('admin','editor','customer') NOT NULL DEFAULT 'customer',
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  phone          VARCHAR(40),
  bio            TEXT,
  avatar_url     VARCHAR(500),
  created_at     VARCHAR(32) NOT NULL,
  updated_at     VARCHAR(32)
);

CREATE TABLE tokens (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  type       ENUM('verify','reset') NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  used       TINYINT(1) NOT NULL DEFAULT 0,
  created_at VARCHAR(32) NOT NULL,
  INDEX idx_tokens_user (user_id, type)
);

CREATE TABLE sessions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at VARCHAR(32) NOT NULL,
  revoked    TINYINT(1) NOT NULL DEFAULT 0,
  created_at VARCHAR(32) NOT NULL,
  INDEX idx_sessions_user (user_id)
);

CREATE TABLE enquiries (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  email      VARCHAR(190) NOT NULL,
  phone      VARCHAR(40),
  intent     ENUM('buy','sell'),
  level      TINYINT,
  message    TEXT NOT NULL,
  status     ENUM('new','contacted','closed') NOT NULL DEFAULT 'new',
  created_at VARCHAR(32) NOT NULL,
  INDEX idx_enquiries_status (status)
);

CREATE TABLE listings (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  price       DECIMAL(12,2) NOT NULL,
  level       TINYINT,
  tech_stack  VARCHAR(300),
  status      ENUM('available','sold') NOT NULL DEFAULT 'available',
  thumbnail   VARCHAR(500),
  created_at  VARCHAR(32) NOT NULL,
  INDEX idx_listings_status (status)
);

CREATE TABLE subscribers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(190) NOT NULL UNIQUE,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(32) NOT NULL
);

CREATE TABLE orders (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT,
  listing_id INT,
  reference  VARCHAR(80) NOT NULL UNIQUE,
  title      VARCHAR(150) NOT NULL,
  amount     DECIMAL(12,2) NOT NULL,
  currency   VARCHAR(8) NOT NULL DEFAULT 'NGN',
  email      VARCHAR(190) NOT NULL,
  name       VARCHAR(120),
  status     ENUM('pending','paid','failed') NOT NULL DEFAULT 'pending',
  paid_at    VARCHAR(32),
  created_at VARCHAR(32) NOT NULL,
  INDEX idx_orders_user (user_id),
  INDEX idx_orders_status (status)
);

CREATE TABLE webauthn_credentials (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       INT NOT NULL DEFAULT 0,
  device_type   VARCHAR(32),
  backed_up     TINYINT(1) NOT NULL DEFAULT 0,
  created_at    VARCHAR(32) NOT NULL,
  INDEX idx_wc_user (user_id)
);

-- ---------- Supabase / Postgres ----------
-- Run this in the Supabase SQL editor instead of the MySQL section.

-- CREATE TABLE users (
--   id             BIGSERIAL PRIMARY KEY,
--   name           TEXT NOT NULL,
--   email          TEXT NOT NULL UNIQUE,
--   password_hash  TEXT NOT NULL,
--   role           TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','editor','customer')),
--   email_verified BOOLEAN NOT NULL DEFAULT FALSE,
--   phone          TEXT,
--   bio            TEXT,
--   avatar_url     TEXT,
--   created_at     TEXT NOT NULL,
--   updated_at     TEXT
-- );
--
-- CREATE TABLE tokens (
--   id         BIGSERIAL PRIMARY KEY,
--   user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--   token_hash TEXT NOT NULL UNIQUE,
--   type       TEXT NOT NULL CHECK (type IN ('verify','reset')),
--   expires_at TEXT NOT NULL,
--   used       BOOLEAN NOT NULL DEFAULT FALSE,
--   created_at TEXT NOT NULL
-- );
--
-- CREATE TABLE sessions (
--   id         BIGSERIAL PRIMARY KEY,
--   user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--   token_hash TEXT NOT NULL UNIQUE,
--   expires_at TEXT NOT NULL,
--   revoked    BOOLEAN NOT NULL DEFAULT FALSE,
--   created_at TEXT NOT NULL
-- );
--
-- CREATE TABLE enquiries (
--   id         BIGSERIAL PRIMARY KEY,
--   name       TEXT NOT NULL,
--   email      TEXT NOT NULL,
--   phone      TEXT,
--   intent     TEXT CHECK (intent IN ('buy','sell')),
--   level      SMALLINT CHECK (level BETWEEN 1 AND 7),
--   message    TEXT NOT NULL,
--   status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
--   created_at TEXT NOT NULL
-- );
--
-- CREATE TABLE listings (
--   id          BIGSERIAL PRIMARY KEY,
--   title       TEXT NOT NULL,
--   description TEXT NOT NULL,
--   price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
--   level       SMALLINT CHECK (level BETWEEN 1 AND 7),
--   tech_stack  TEXT,
--   status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold')),
--   thumbnail   TEXT,
--   created_at  TEXT NOT NULL
-- );
--
-- CREATE TABLE subscribers (
--   id         BIGSERIAL PRIMARY KEY,
--   email      TEXT NOT NULL UNIQUE,
--   active     BOOLEAN NOT NULL DEFAULT TRUE,
--   created_at TEXT NOT NULL
-- );
--
-- CREATE TABLE orders (
--   id         BIGSERIAL PRIMARY KEY,
--   user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
--   listing_id BIGINT,
--   reference  TEXT NOT NULL UNIQUE,
--   title      TEXT NOT NULL,
--   amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
--   currency   TEXT NOT NULL DEFAULT 'NGN',
--   email      TEXT NOT NULL,
--   name       TEXT,
--   status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
--   paid_at    TEXT,
--   created_at TEXT NOT NULL
-- );
--
-- CREATE TABLE webauthn_credentials (
--   id            BIGSERIAL PRIMARY KEY,
--   user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--   credential_id TEXT NOT NULL UNIQUE,
--   public_key    TEXT NOT NULL,
--   counter       INTEGER NOT NULL DEFAULT 0,
--   device_type   TEXT,
--   backed_up     BOOLEAN NOT NULL DEFAULT FALSE,
--   created_at    TEXT NOT NULL
-- );
