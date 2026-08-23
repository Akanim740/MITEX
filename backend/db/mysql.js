let pool;

async function init() {
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    throw new Error("MySQL driver not installed. Run: npm install mysql2");
  }

  pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "mitex",
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
  });

  try {
    const [cols] = await pool.query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listings' AND COLUMN_NAME = 'delivery_url'"
    );
    if (!cols[0].n) {
      await pool.query("ALTER TABLE listings ADD COLUMN delivery_url VARCHAR(800)");
    }

    // Staff system migrations (safe to run repeatedly)
    const [roleCol] = await pool.query(
      "SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'"
    );
    if (roleCol[0] && !String(roleCol[0].t).includes("'staff'")) {
      await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('admin','editor','staff','customer') NOT NULL DEFAULT 'customer'");
    }
    const [activeCol] = await pool.query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'active'"
    );
    if (!activeCol[0].n) {
      await pool.query("ALTER TABLE users ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1");
    }
    const [empCol] = await pool.query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listings' AND COLUMN_NAME = 'employee_id'"
    );
    if (!empCol[0].n) {
      await pool.query("ALTER TABLE listings ADD COLUMN employee_id INT NULL, ADD INDEX idx_listings_employee (employee_id)");
    }
  } catch {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      name           VARCHAR(120) NOT NULL,
      email          VARCHAR(190) NOT NULL UNIQUE,
      password_hash  VARCHAR(255) NOT NULL,
      role           ENUM('admin','editor','staff','customer') NOT NULL DEFAULT 'customer',
      email_verified TINYINT(1) NOT NULL DEFAULT 0,
      phone          VARCHAR(40),
      bio            TEXT,
      avatar_url     VARCHAR(500),
      active         TINYINT(1) NOT NULL DEFAULT 1,
      created_at     VARCHAR(32) NOT NULL,
      updated_at     VARCHAR(32)
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      type       ENUM('verify','reset') NOT NULL,
      expires_at VARCHAR(32) NOT NULL,
      used       TINYINT(1) NOT NULL DEFAULT 0,
      created_at VARCHAR(32) NOT NULL,
      INDEX idx_tokens_user (user_id, type)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at VARCHAR(32) NOT NULL,
      revoked    TINYINT(1) NOT NULL DEFAULT 0,
      created_at VARCHAR(32) NOT NULL,
      INDEX idx_sessions_user (user_id)
    );

    CREATE TABLE IF NOT EXISTS enquiries (
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

    CREATE TABLE IF NOT EXISTS listings (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      title        VARCHAR(150) NOT NULL,
      description  TEXT NOT NULL,
      price        DECIMAL(12,2) NOT NULL,
      level        TINYINT,
      tech_stack   VARCHAR(300),
      status       ENUM('available','sold') NOT NULL DEFAULT 'available',
      thumbnail    VARCHAR(500),
      delivery_url VARCHAR(800),
      employee_id  INT NULL,
      created_at   VARCHAR(32) NOT NULL,
      INDEX idx_listings_status (status),
      INDEX idx_listings_employee (employee_id)
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      email      VARCHAR(190) NOT NULL UNIQUE,
      active     TINYINT(1) NOT NULL DEFAULT 1,
      created_at VARCHAR(32) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
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

    CREATE TABLE IF NOT EXISTS webauthn_credentials (
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
  `);

  return api;
}

const nowISO = () => new Date().toISOString();

function stripSecret(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return { ...rest, id: String(rest.id) };
}

const users = {
  async count() {
    const [rows] = await pool.query("SELECT COUNT(*) AS n FROM users");
    return rows[0].n;
  },
  async findByEmail(email) {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [String(email).toLowerCase()]);
    return rows[0] || null;
  },
  async findById(id) {
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
    return rows[0] || null;
  },
  async create({ name, email, passwordHash, role = "customer", emailVerified = 0, phone = null, bio = null, avatar_url = null, active }) {
    const [res] = await pool.query(
      "INSERT INTO users (name, email, password_hash, role, email_verified, phone, bio, avatar_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [name, String(email).toLowerCase(), passwordHash, role, emailVerified ? 1 : 0, phone, bio, avatar_url, active === undefined ? 1 : active ? 1 : 0, nowISO()]
    );
    return this.findById(res.insertId);
  },
  async update(id, patch) {
    const allowed = ["name", "phone", "bio", "avatar_url", "role", "email_verified", "active"];
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!keys.length) return this.findById(id);
    const vals = keys.map((k) => (typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : patch[k]));
    await pool.query(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [
      ...vals,
      nowISO(),
      id,
    ]);
    return this.findById(id);
  },
  async countByRole(role) {
    const [rows] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = ?", [role]);
    return rows[0].n;
  },
  async listByRole(role) {
    const [rows] = await pool.query("SELECT * FROM users WHERE role = ? ORDER BY created_at ASC", [role]);
    return rows;
  },
  async updatePassword(id, passwordHash) {
    await pool.query("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [passwordHash, nowISO(), id]);
  },
  async list() {
    const [rows] = await pool.query("SELECT * FROM users ORDER BY created_at DESC");
    return rows;
  },
  async remove(id) {
    const [res] = await pool.query("DELETE FROM users WHERE id = ?", [id]);
    return res.affectedRows > 0;
  },
};

const tokens = {
  async create({ userId, tokenHash, type, expiresAt }) {
    await pool.query("INSERT INTO tokens (user_id, token_hash, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", [
      userId,
      tokenHash,
      type,
      expiresAt,
      nowISO(),
    ]);
  },
  async findValid(tokenHash, type) {
    const [rows] = await pool.query(
      "SELECT * FROM tokens WHERE token_hash = ? AND type = ? AND used = 0 AND expires_at > ?",
      [tokenHash, type, nowISO()]
    );
    return rows[0] || null;
  },
  async markUsed(id) {
    await pool.query("UPDATE tokens SET used = 1 WHERE id = ?", [id]);
  },
  async deleteByUser(userId, type) {
    await pool.query("DELETE FROM tokens WHERE user_id = ? AND type = ?", [userId, type]);
  },
};

const sessions = {
  async create({ userId, tokenHash, expiresAt }) {
    await pool.query("INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)", [
      userId,
      tokenHash,
      expiresAt,
      nowISO(),
    ]);
  },
  async findValid(tokenHash) {
    const [rows] = await pool.query("SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > ?", [
      tokenHash,
      nowISO(),
    ]);
    return rows[0] || null;
  },
  async revoke(id) {
    await pool.query("UPDATE sessions SET revoked = 1 WHERE id = ?", [id]);
  },
  async revokeAllForUser(userId) {
    await pool.query("UPDATE sessions SET revoked = 1 WHERE user_id = ?", [userId]);
  },
};

const enquiries = {
  async create(v) {
    const [res] = await pool.query(
      "INSERT INTO enquiries (name, email, phone, intent, level, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [v.name, v.email, v.phone, v.intent, v.level, v.message, nowISO()]
    );
    return this.get(res.insertId);
  },
  async list(status) {
    const [rows] = status
      ? await pool.query("SELECT * FROM enquiries WHERE status = ? ORDER BY created_at DESC", [status])
      : await pool.query("SELECT * FROM enquiries ORDER BY created_at DESC");
    return rows;
  },
  async get(id) {
    const [rows] = await pool.query("SELECT * FROM enquiries WHERE id = ?", [id]);
    return rows[0] || null;
  },
  async setStatus(id, status) {
    const [res] = await pool.query("UPDATE enquiries SET status = ? WHERE id = ?", [status, id]);
    return res.affectedRows > 0;
  },
  async remove(id) {
    const [res] = await pool.query("DELETE FROM enquiries WHERE id = ?", [id]);
    return res.affectedRows > 0;
  },
  async stats() {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS total, SUM(status='new') AS new, SUM(status='contacted') AS contacted, SUM(status='closed') AS closed FROM enquiries"
    );
    const r = rows[0];
    return { total: r.total || 0, new: r.new || 0, contacted: r.contacted || 0, closed: r.closed || 0 };
  },
};

const listings = {
  async list({ includeSold = false, level } = {}) {
    const where = [];
    const params = [];
    if (!includeSold) where.push("status = 'available'");
    if (level !== undefined && level !== null && level !== "") {
      where.push("level = ?");
      params.push(Number(level));
    }
    const sql =
      "SELECT * FROM listings" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY created_at DESC";
    const [rows] = await pool.query(sql, params);
    return rows;
  },
  async get(id) {
    const [rows] = await pool.query("SELECT * FROM listings WHERE id = ?", [id]);
    return rows[0] || null;
  },
  async create(v) {
    const [res] = await pool.query(
      "INSERT INTO listings (title, description, price, level, tech_stack, status, thumbnail, delivery_url, employee_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [v.title, v.description, v.price, v.level ?? null, v.tech_stack ?? null, v.status ?? "available", v.thumbnail ?? null, v.delivery_url ?? v.deliveryUrl ?? null, v.employee_id ?? null, nowISO()]
    );
    return this.get(res.insertId);
  },
  async update(id, patch) {
    const allowed = ["title", "description", "price", "level", "tech_stack", "status", "thumbnail", "delivery_url", "employee_id"];
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!keys.length) return this.get(id);
    const vals = keys.map((k) => (patch[k] === undefined ? null : patch[k]));
    await pool.query(`UPDATE listings SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...vals, id]);
    return this.get(id);
  },
  async listForEmployee(employeeId) {
    const [rows] = await pool.query("SELECT * FROM listings WHERE employee_id = ? ORDER BY created_at DESC", [employeeId]);
    return rows;
  },
  async unassignEmployee(employeeId) {
    const [res] = await pool.query("UPDATE listings SET employee_id = NULL WHERE employee_id = ?", [employeeId]);
    return res.affectedRows;
  },
  async remove(id) {
    const [res] = await pool.query("DELETE FROM listings WHERE id = ?", [id]);
    return res.affectedRows > 0;
  },
  async stats() {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS total, SUM(status='available') AS available, SUM(status='sold') AS sold, COALESCE(SUM(CASE WHEN status='available' THEN price END),0) AS inventoryValue FROM listings"
    );
    const r = rows[0];
    return {
      total: r.total || 0,
      available: r.available || 0,
      sold: r.sold || 0,
      inventoryValue: Number(r.inventoryValue) || 0,
    };
  },
};

const subscribers = {
  async findByEmail(email) {
    const [rows] = await pool.query("SELECT * FROM subscribers WHERE email = ?", [String(email).toLowerCase()]);
    return rows[0] || null;
  },
  async activate(email) {
    const [res] = await pool.query("UPDATE subscribers SET active = 1 WHERE email = ?", [String(email).toLowerCase()]);
    return res.affectedRows > 0;
  },
  async create(email) {
    await pool.query("INSERT INTO subscribers (email, created_at) VALUES (?, ?)", [String(email).toLowerCase(), nowISO()]);
  },
  async deactivate(email) {
    const [res] = await pool.query("UPDATE subscribers SET active = 0 WHERE email = ?", [String(email).toLowerCase()]);
    return res.affectedRows > 0;
  },
  async listActive() {
    const [rows] = await pool.query("SELECT id, email, created_at FROM subscribers WHERE active = 1 ORDER BY created_at DESC");
    return rows;
  },
  async countActive() {
    const [rows] = await pool.query("SELECT COUNT(*) AS n FROM subscribers WHERE active = 1");
    return rows[0].n;
  },
};

const orders = {
  async create(v) {
    await pool.query(
      "INSERT INTO orders (user_id, listing_id, reference, title, amount, currency, email, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [v.userId ?? null, v.listingId ?? null, v.reference, v.title, v.amount, v.currency || "NGN", v.email, v.name ?? null, nowISO()]
    );
    return this.findByReference(v.reference);
  },
  async findByReference(reference) {
    const [rows] = await pool.query("SELECT * FROM orders WHERE reference = ?", [reference]);
    return rows[0] || null;
  },
  async getById(id) {
    const [rows] = await pool.query("SELECT * FROM orders WHERE id = ?", [id]);
    return rows[0] || null;
  },
  async markPaid(reference, paidAt) {
    const [res] = await pool.query("UPDATE orders SET status = 'paid', paid_at = ? WHERE reference = ?", [paidAt, reference]);
    return res.affectedRows > 0;
  },
  async markFailed(reference) {
    const [res] = await pool.query("UPDATE orders SET status = 'failed' WHERE reference = ? AND status = 'pending'", [reference]);
    return res.affectedRows > 0;
  },
  async listForUser(userId) {
    const [rows] = await pool.query("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", [userId]);
    return rows;
  },
  async listAll(status) {
    const [rows] = status
      ? await pool.query("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC", [status])
      : await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    return rows;
  },
  async stats() {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS total, SUM(status='paid') AS paid, SUM(status='pending') AS pending, SUM(status='failed') AS failed, COALESCE(SUM(CASE WHEN status='paid' THEN amount END),0) AS revenue FROM orders"
    );
    const r = rows[0];
    return { total: r.total || 0, paid: r.paid || 0, pending: r.pending || 0, failed: r.failed || 0, revenue: Number(r.revenue) || 0 };
  },
};

const credentials = {
  async create(v) {
    await pool.query(
      "INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_type, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [v.userId, v.credentialId, v.publicKey, v.counter || 0, v.deviceType ?? null, v.backedUp ? 1 : 0, nowISO()]
    );
    return this.findByCredentialId(v.credentialId);
  },
  async findByCredentialId(credentialId) {
    const [rows] = await pool.query("SELECT * FROM webauthn_credentials WHERE credential_id = ?", [credentialId]);
    return rows[0] || null;
  },
  async listForUser(userId) {
    const [rows] = await pool.query("SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC", [userId]);
    return rows;
  },
  async updateCounter(id, counter) {
    const [res] = await pool.query("UPDATE webauthn_credentials SET counter = ? WHERE id = ?", [counter, id]);
    return res.affectedRows > 0;
  },
  async remove(id) {
    const [res] = await pool.query("DELETE FROM webauthn_credentials WHERE id = ?", [id]);
    return res.affectedRows > 0;
  },
};

const api = {
  name: "mysql",
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

module.exports = { init };
