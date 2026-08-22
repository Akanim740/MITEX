const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(DATA_DIR, "mitex.db");

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','editor','customer')),
    email_verified INTEGER NOT NULL DEFAULT 0,
    phone          TEXT,
    bio            TEXT,
    avatar_url     TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL CHECK (type IN ('verify','reset')),
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    phone      TEXT,
    intent     TEXT CHECK (intent IN ('buy','sell')),
    level      INTEGER CHECK (level BETWEEN 1 AND 7),
    message    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS listings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL,
    price        REAL NOT NULL CHECK (price >= 0),
    level        INTEGER CHECK (level BETWEEN 1 AND 7),
    tech_stack   TEXT,
    status       TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold')),
    thumbnail    TEXT,
    delivery_url TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    listing_id INTEGER,
    reference  TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL,
    amount     REAL NOT NULL CHECK (amount >= 0),
    currency   TEXT NOT NULL DEFAULT 'NGN',
    email      TEXT NOT NULL,
    name       TEXT,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
    paid_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key    TEXT NOT NULL,
    counter       INTEGER NOT NULL DEFAULT 0,
    device_type   TEXT,
    backed_up     INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

for (const col of ["delivery_url"]) {
  const cols = db.prepare("PRAGMA table_info(listings)").all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE listings ADD COLUMN ${col} TEXT`);
}

const nowISO = () => new Date().toISOString();

function stripSecret(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return rest;
}

const users = {
  async count() {
    return db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  },
  async findByEmail(email) {
    return db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase()) || null;
  },
  async findById(id) {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
  },
  async create({ name, email, passwordHash, role = "customer", emailVerified = 0 }) {
    const res = db
      .prepare("INSERT INTO users (name, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, ?)")
      .run(name, String(email).toLowerCase(), passwordHash, role, emailVerified ? 1 : 0);
    return this.findById(res.lastInsertRowid);
  },
  async update(id, patch) {
    const allowed = ["name", "phone", "bio", "avatar_url", "role", "email_verified"];
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!keys.length) return this.findById(id);
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const vals = keys.map((k) => (typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : patch[k]));
    db.prepare(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`).run(...vals, nowISO(), id);
    return this.findById(id);
  },
  async updatePassword(id, passwordHash) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, nowISO(), id);
  },
  async list() {
    return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
  },
  async remove(id) {
    return db.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0;
  },
};

const tokens = {
  async create({ userId, tokenHash, type, expiresAt }) {
    const res = db
      .prepare("INSERT INTO tokens (user_id, token_hash, type, expires_at) VALUES (?, ?, ?, ?)")
      .run(userId, tokenHash, type, expiresAt);
    return res.lastInsertRowid;
  },
  async findValid(tokenHash, type) {
    return (
      db
        .prepare("SELECT * FROM tokens WHERE token_hash = ? AND type = ? AND used = 0 AND expires_at > ?")
        .get(tokenHash, type, nowISO()) || null
    );
  },
  async markUsed(id) {
    db.prepare("UPDATE tokens SET used = 1 WHERE id = ?").run(id);
  },
  async deleteByUser(userId, type) {
    db.prepare("DELETE FROM tokens WHERE user_id = ? AND type = ?").run(userId, type);
  },
};

const sessions = {
  async create({ userId, tokenHash, expiresAt }) {
    const res = db
      .prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
      .run(userId, tokenHash, expiresAt);
    return res.lastInsertRowid;
  },
  async findValid(tokenHash) {
    return (
      db
        .prepare("SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > ?")
        .get(tokenHash, nowISO()) || null
    );
  },
  async revoke(id) {
    db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").run(id);
  },
  async revokeAllForUser(userId) {
    db.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?").run(userId);
  },
};

const enquiries = {
  async create(v) {
    const res = db
      .prepare(
        "INSERT INTO enquiries (name, email, phone, intent, level, message) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(v.name, v.email, v.phone, v.intent, v.level, v.message);
    return this.get(res.lastInsertRowid);
  },
  async list(status) {
    if (status) {
      return db.prepare("SELECT * FROM enquiries WHERE status = ? ORDER BY created_at DESC").all(status);
    }
    return db.prepare("SELECT * FROM enquiries ORDER BY created_at DESC").all();
  },
  async get(id) {
    return db.prepare("SELECT * FROM enquiries WHERE id = ?").get(id) || null;
  },
  async setStatus(id, status) {
    return db.prepare("UPDATE enquiries SET status = ? WHERE id = ?").run(status, id).changes > 0;
  },
  async remove(id) {
    return db.prepare("DELETE FROM enquiries WHERE id = ?").run(id).changes > 0;
  },
  async stats() {
    const total = db.prepare("SELECT COUNT(*) AS n FROM enquiries").get().n;
    const by = (s) => db.prepare("SELECT COUNT(*) AS n FROM enquiries WHERE status = ?").get(s).n;
    return { total, new: by("new"), contacted: by("contacted"), closed: by("closed") };
  },
};

const listings = {
  async list({ includeSold = false, level } = {}) {
    let sql = "SELECT * FROM listings";
    const where = [];
    const params = [];
    if (!includeSold) {
      where.push("status = 'available'");
    }
    if (level !== undefined && level !== null && level !== "") {
      where.push("level = ?");
      params.push(Number(level));
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY created_at DESC";
    return db.prepare(sql).all(...params);
  },
  async get(id) {
    return db.prepare("SELECT * FROM listings WHERE id = ?").get(id) || null;
  },
  async create(v) {
    const res = db
      .prepare(
        "INSERT INTO listings (title, description, price, level, tech_stack, status, thumbnail, delivery_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(v.title, v.description, v.price, v.level ?? null, v.tech_stack ?? null, v.status ?? "available", v.thumbnail ?? null, v.deliveryUrl ?? null);
    return this.get(res.lastInsertRowid);
  },
  async update(id, patch) {
    const allowed = ["title", "description", "price", "level", "tech_stack", "status", "thumbnail", "delivery_url"];
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!keys.length) return this.get(id);
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const vals = keys.map((k) => (patch[k] === undefined ? null : patch[k]));
    db.prepare(`UPDATE listings SET ${sets} WHERE id = ?`).run(...vals, id);
    return this.get(id);
  },
  async remove(id) {
    return db.prepare("DELETE FROM listings WHERE id = ?").run(id).changes > 0;
  },
  async stats() {
    const total = db.prepare("SELECT COUNT(*) AS n FROM listings").get().n;
    const available = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'available'").get().n;
    const sold = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'sold'").get().n;
    const inventoryValue = db
      .prepare("SELECT COALESCE(SUM(price), 0) AS v FROM listings WHERE status = 'available'")
      .get().v;
    return { total, available, sold, inventoryValue };
  },
};

const subscribers = {
  async findByEmail(email) {
    return db.prepare("SELECT * FROM subscribers WHERE email = ?").get(String(email).toLowerCase()) || null;
  },
  async activate(email) {
    return db.prepare("UPDATE subscribers SET active = 1 WHERE email = ?").run(String(email).toLowerCase()).changes > 0;
  },
  async create(email) {
    db.prepare("INSERT INTO subscribers (email) VALUES (?)").run(String(email).toLowerCase());
  },
  async deactivate(email) {
    return db.prepare("UPDATE subscribers SET active = 0 WHERE email = ?").run(String(email).toLowerCase()).changes > 0;
  },
  async listActive() {
    return db.prepare("SELECT id, email, created_at FROM subscribers WHERE active = 1 ORDER BY created_at DESC").all();
  },
  async countActive() {
    return db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE active = 1").get().n;
  },
};

const orders = {
  async create(v) {
    const res = db
      .prepare(
        "INSERT INTO orders (user_id, listing_id, reference, title, amount, currency, email, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(v.userId ?? null, v.listingId ?? null, v.reference, v.title, v.amount, v.currency || "NGN", v.email, v.name ?? null);
    return this.findByReference(v.reference);
  },
  async findByReference(reference) {
    return db.prepare("SELECT * FROM orders WHERE reference = ?").get(reference) || null;
  },
  async getById(id) {
    return db.prepare("SELECT * FROM orders WHERE id = ?").get(id) || null;
  },
  async markPaid(reference, paidAt) {
    return db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE reference = ?").run(paidAt, reference).changes > 0;
  },
  async markFailed(reference) {
    return db.prepare("UPDATE orders SET status = 'failed' WHERE reference = ? AND status = 'pending'").run(reference).changes > 0;
  },
  async listForUser(userId) {
    return db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").all(userId);
  },
  async listAll(status) {
    if (status) {
      return db.prepare("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC").all(status);
    }
    return db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  },
  async stats() {
    const total = db.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
    const by = (s) => db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = ?").get(s).n;
    const revenue = db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM orders WHERE status = 'paid'").get().v;
    return { total, paid: by("paid"), pending: by("pending"), failed: by("failed"), revenue };
  },
};

const credentials = {
  async create(v) {
    db.prepare(
      "INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_type, backed_up) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(v.userId, v.credentialId, v.publicKey, v.counter || 0, v.deviceType ?? null, v.backedUp ? 1 : 0);
    return this.findByCredentialId(v.credentialId);
  },
  async findByCredentialId(credentialId) {
    return db.prepare("SELECT * FROM webauthn_credentials WHERE credential_id = ?").get(credentialId) || null;
  },
  async listForUser(userId) {
    return db.prepare("SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC").all(userId);
  },
  async updateCounter(id, counter) {
    return db.prepare("UPDATE webauthn_credentials SET counter = ? WHERE id = ?").run(counter, id).changes > 0;
  },
  async remove(id) {
    return db.prepare("DELETE FROM webauthn_credentials WHERE id = ?").run(id).changes > 0;
  },
};

module.exports = {
  name: "sqlite",
  file: DB_FILE,
  users,
  tokens,
  sessions,
  enquiries,
  listings,
  subscribers,
  orders,
  credentials,
  _publicUser: stripSecret,
};
