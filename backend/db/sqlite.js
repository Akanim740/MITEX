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
    role           TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','editor','staff','customer')),
    email_verified INTEGER NOT NULL DEFAULT 0,
    phone          TEXT,
    bio            TEXT,
    avatar_url     TEXT,
    country        TEXT NOT NULL DEFAULT 'NG',
    locale         TEXT NOT NULL DEFAULT 'en',
    dob            TEXT,
    nin_bvn        TEXT,
    nin_file       TEXT,
    payment_enc    TEXT,
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
    notes      TEXT,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
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

  CREATE TABLE IF NOT EXISTS applications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
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
    staff_user_id     INTEGER,
    hire_token        TEXT UNIQUE,
    hire_completed    INTEGER NOT NULL DEFAULT 0,
    payment_enc       TEXT,
    dob               TEXT,
    nin_bvn           TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS salaries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_user_id INTEGER NOT NULL,
    amount        INTEGER NOT NULL,
    bonus         INTEGER NOT NULL DEFAULT 0,
    period        TEXT NOT NULL,
    note          TEXT,
    paid_at       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    email      TEXT,
    action     TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

for (const col of ["delivery_url", "employee_id"]) {
  const cols = db.prepare("PRAGMA table_info(listings)").all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE listings ADD COLUMN ${col} ${col === "employee_id" ? "INTEGER" : "TEXT"}`);
}

// Older databases were created with a role CHECK that lacks 'staff'.
// SQLite cannot alter a CHECK constraint, so rebuild the users table once.
const usersTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
if (usersTableSql && !String(usersTableSql.sql).includes("'staff'")) {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  db.exec(`
    CREATE TABLE users_new (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      email          TEXT NOT NULL UNIQUE,
      password_hash  TEXT NOT NULL,
      role           TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','editor','staff','customer')),
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone          TEXT,
      bio            TEXT,
      avatar_url     TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      country        TEXT NOT NULL DEFAULT 'NG',
      locale         TEXT NOT NULL DEFAULT 'en',
      dob            TEXT,
      nin_bvn        TEXT,
      nin_file       TEXT,
      payment_enc    TEXT,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at     TEXT
    );
    INSERT INTO users_new (id, name, email, password_hash, role, email_verified, phone, bio, avatar_url, country, locale, created_at, updated_at)
      SELECT id, name, email, password_hash, role, email_verified, phone, bio, avatar_url, 'NG', 'en', created_at, updated_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);
  db.exec("COMMIT");
  db.exec("PRAGMA foreign_keys = ON");
}

{
  const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!userCols.includes("active")) db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  if (!userCols.includes("country")) db.exec("ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT 'NG'");
  if (!userCols.includes("locale")) db.exec("ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'");
  if (!userCols.includes("dob")) db.exec("ALTER TABLE users ADD COLUMN dob TEXT");
  if (!userCols.includes("nin_bvn")) db.exec("ALTER TABLE users ADD COLUMN nin_bvn TEXT");
  if (!userCols.includes("nin_file")) db.exec("ALTER TABLE users ADD COLUMN nin_file TEXT");
  if (!userCols.includes("payment_enc")) db.exec("ALTER TABLE users ADD COLUMN payment_enc TEXT");
}

{
  const appCols = db.prepare("PRAGMA table_info(applications)").all().map((c) => c.name);
  if (!appCols.includes("payment_enc")) db.exec("ALTER TABLE applications ADD COLUMN payment_enc TEXT");
  if (!appCols.includes("dob")) db.exec("ALTER TABLE applications ADD COLUMN dob TEXT");
  if (!appCols.includes("nin_bvn")) db.exec("ALTER TABLE applications ADD COLUMN nin_bvn TEXT");
}

// Older databases were created with an orders status CHECK that lacks 'refunded'.
// SQLite cannot alter a CHECK constraint, so rebuild the orders table once.
const ordersTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get();
if (ordersTableSql && !String(ordersTableSql.sql).includes("'refunded'")) {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  db.exec(`
    CREATE TABLE orders_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      listing_id INTEGER,
      reference  TEXT NOT NULL UNIQUE,
      title      TEXT NOT NULL,
      amount     REAL NOT NULL CHECK (amount >= 0),
      currency   TEXT NOT NULL DEFAULT 'NGN',
      email      TEXT NOT NULL,
      name       TEXT,
      notes      TEXT,
      status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
      paid_at    TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO orders_new (id, user_id, listing_id, reference, title, amount, currency, email, name, status, paid_at, created_at)
      SELECT id, user_id, listing_id, reference, title, amount, currency, email, name, status, paid_at, created_at FROM orders;
    DROP TABLE orders;
    ALTER TABLE orders_new RENAME TO orders;
  `);
  db.exec("COMMIT");
  db.exec("PRAGMA foreign_keys = ON");
}

{
  const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!orderCols.includes("notes")) db.exec("ALTER TABLE orders ADD COLUMN notes TEXT");
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
  async create({ name, email, passwordHash, role = "customer", emailVerified = 0, phone = null, bio = null, avatar_url = null, active, country = "NG", locale = "en", dob = null, nin_bvn = null, nin_file = null, payment_enc = null }) {
    const res = db
      .prepare("INSERT INTO users (name, email, password_hash, role, email_verified, phone, bio, avatar_url, active, country, locale, dob, nin_bvn, nin_file, payment_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(name, String(email).toLowerCase(), passwordHash, role, emailVerified ? 1 : 0, phone, bio, avatar_url, active === undefined ? 1 : active ? 1 : 0, country, locale, dob, nin_bvn, nin_file, payment_enc);
    return this.findById(res.lastInsertRowid);
  },
  async update(id, patch) {
    const allowed = ["name", "phone", "bio", "avatar_url", "role", "email_verified", "active", "country", "locale", "dob", "nin_bvn", "nin_file", "payment_enc"];
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!keys.length) return this.findById(id);
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const vals = keys.map((k) => (typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : patch[k]));
    db.prepare(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`).run(...vals, nowISO(), id);
    return this.findById(id);
  },
  async countByRole(role) {
    return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = ?").get(role).n;
  },
  async listByRole(role) {
    return db.prepare("SELECT * FROM users WHERE role = ? ORDER BY created_at ASC").all(role);
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
        "INSERT INTO listings (title, description, price, level, tech_stack, status, thumbnail, delivery_url, employee_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(v.title, v.description, v.price, v.level ?? null, v.tech_stack ?? null, v.status ?? "available", v.thumbnail ?? null, v.delivery_url ?? v.deliveryUrl ?? null, v.employee_id ?? null);
    return this.get(res.lastInsertRowid);
  },
  async update(id, patch) {
    const allowed = ["title", "description", "price", "level", "tech_stack", "status", "thumbnail", "delivery_url", "employee_id"];
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
  async listForEmployee(employeeId) {
    return db.prepare("SELECT * FROM listings WHERE employee_id = ? ORDER BY created_at DESC").all(employeeId);
  },
  async unassignEmployee(employeeId) {
    return db.prepare("UPDATE listings SET employee_id = NULL WHERE employee_id = ?").run(employeeId).changes;
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
        "INSERT INTO orders (user_id, listing_id, reference, title, amount, currency, email, name, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(v.userId ?? null, v.listingId ?? null, v.reference, v.title, v.amount, v.currency || "NGN", v.email, v.name ?? null, v.notes ?? null);
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
  async updateStatus(reference, status) {
    return db.prepare("UPDATE orders SET status = ? WHERE reference = ?").run(status, reference).changes > 0;
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

const applications = {
  _safe(row) {
    if (!row) return row;
    const { test_token, hire_token, ...rest } = row;
    return rest;
  },
  async create(v) {
    const res = db
      .prepare("INSERT INTO applications (name, email, phone, portfolio, message, dob, nin_bvn) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(v.name, String(v.email).toLowerCase(), v.phone ?? null, v.portfolio ?? null, v.message, v.dob ?? null, v.nin_bvn ?? null);
    return this.get(res.lastInsertRowid);
  },
  async findByEmail(email) {
    return (
      db
        .prepare("SELECT * FROM applications WHERE email = ? AND status != 'rejected' ORDER BY created_at DESC LIMIT 1")
        .get(String(email).toLowerCase()) || null
    );
  },
  async get(id) {
    return db.prepare("SELECT * FROM applications WHERE id = ?").get(id) || null;
  },
  async getByTestToken(token) {
    return db.prepare("SELECT * FROM applications WHERE test_token = ?").get(token) || null;
  },
  async getByHireToken(token) {
    return db.prepare("SELECT * FROM applications WHERE hire_token = ? AND hire_completed = 0").get(token) || null;
  },
  async list(status) {
    if (status) {
      return db.prepare("SELECT * FROM applications WHERE status = ? ORDER BY created_at DESC").all(status);
    }
    return db.prepare("SELECT * FROM applications ORDER BY created_at DESC").all();
  },
  async setTest(id, { testToken, instructions }) {
    db.prepare("UPDATE applications SET status = 'test_sent', test_token = ?, test_instructions = ?, test_sent_at = ? WHERE id = ?").run(
      testToken,
      instructions,
      nowISO(),
      id
    );
    return this.get(id);
  },
  async setSubmission(id, { url, notes }) {
    db.prepare("UPDATE applications SET status = 'submitted', submit_url = ?, submit_notes = ?, submitted_at = ? WHERE id = ?").run(
      url,
      notes ?? null,
      nowISO(),
      id
    );
    return this.get(id);
  },
  async setPayDetails(id, enc) {
    db.prepare("UPDATE applications SET payment_enc = ? WHERE id = ?").run(enc, id);
    return this.get(id);
  },
  async markHired(id, { staffUserId, hireToken }) {
    db.prepare("UPDATE applications SET status = 'passed', staff_user_id = ?, hire_token = ? WHERE id = ?").run(
      String(staffUserId),
      hireToken,
      id
    );
    return this.get(id);
  },
  async completeHire(id) {
    db.prepare("UPDATE applications SET hire_completed = 1 WHERE id = ?").run(id);
  },
  async setStatus(id, status) {
    return db.prepare("UPDATE applications SET status = ? WHERE id = ?").run(status, id).changes > 0;
  },
  async remove(id) {
    return db.prepare("DELETE FROM applications WHERE id = ?").run(id).changes > 0;
  },
};

const salaries = {
  async create(v) {
    const res = db
      .prepare("INSERT INTO salaries (staff_user_id, amount, bonus, period, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(String(v.staffUserId), Math.round(v.amount), Math.round(v.bonus || 0), v.period, v.note ?? null, nowISO());
    return this.getById(res.lastInsertRowid);
  },
  async getById(id) {
    return db.prepare("SELECT * FROM salaries WHERE id = ?").get(id) || null;
  },
  async listForStaff(staffUserId) {
    return db.prepare("SELECT * FROM salaries WHERE staff_user_id = ? ORDER BY created_at DESC").all(String(staffUserId));
  },
  async listAll(period) {
    return period
      ? db.prepare("SELECT * FROM salaries WHERE period = ? ORDER BY created_at DESC").all(period)
      : db.prepare("SELECT * FROM salaries ORDER BY created_at DESC").all();
  },
  async totalForPeriod(period) {
    const row = db.prepare("SELECT COALESCE(SUM(amount + bonus),0) AS n FROM salaries WHERE period = ?").get(period);
    return row.n;
  },
  async remove(id) {
    return db.prepare("DELETE FROM salaries WHERE id = ?").run(id).changes > 0;
  },
};

const audit = {
  async log({ userId, email, action, detail, ip }) {
    db.prepare("INSERT INTO audit_logs (user_id, email, action, detail, ip) VALUES (?, ?, ?, ?, ?)").run(
      userId || null,
      email || null,
      action,
      detail || null,
      ip || null
    );
  },
  async list(limit = 100) {
    return db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?").all(limit);
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
  applications,
  salaries,
  audit,
  _publicUser: stripSecret,
};
