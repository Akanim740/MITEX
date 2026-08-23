let db;
let client;

function toPublic(row) {
  if (!row) return null;
  const { _id, password_hash, ...rest } = row;
  return { ...rest, id: String(_id) };
}

function oid(id) {
  const { ObjectId } = require("mongodb");
  return new ObjectId(String(id));
}

async function init() {
  let mongoClient;
  try {
    ({ MongoClient: mongoClient } = require("mongodb"));
  } catch {
    throw new Error("MongoDB driver not installed. Run: npm install mongodb");
  }

  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGO_DB || "mitex";
  client = new mongoClient(uri);
  await client.connect();
  db = client.db(dbName);

  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("tokens").createIndex({ token_hash: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ token_hash: 1 }, { unique: true });
  await db.collection("subscribers").createIndex({ email: 1 }, { unique: true });

  return api;
}

const nowISO = () => new Date().toISOString();

async function insertOne(collection, doc) {
  const res = await db.collection(collection).insertOne(doc);
  return { ...doc, _id: res.insertedId };
}

const users = {
  async count() {
    return db.collection("users").countDocuments();
  },
  async findByEmail(email) {
    return db.collection("users").findOne({ email: String(email).toLowerCase() });
  },
  async findById(id) {
    try {
      return await db.collection("users").findOne({ _id: oid(id) });
    } catch {
      return null;
    }
  },
  async create({ name, email, passwordHash, role = "customer", emailVerified = 0, phone = null, bio = null, avatar_url = null, active }) {
    const doc = {
      name,
      email: String(email).toLowerCase(),
      password_hash: passwordHash,
      role,
      email_verified: emailVerified ? 1 : 0,
      phone,
      bio,
      avatar_url,
      active: active === undefined ? 1 : active ? 1 : 0,
      created_at: nowISO(),
      updated_at: null,
    };
    const row = await insertOne("users", doc);
    return { ...row, id: String(row._id) };
  },
  async update(id, patch) {
    const allowed = ["name", "phone", "bio", "avatar_url", "role", "email_verified", "active"];
    const set = {};
    for (const k of allowed) if (k in patch) set[k] = typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : patch[k];
    if (!Object.keys(set).length) return this.findById(id);
    set.updated_at = nowISO();
    await db.collection("users").updateOne({ _id: oid(id) }, { $set: set });
    return this.findById(id);
  },
  async countByRole(role) {
    return db.collection("users").countDocuments({ role });
  },
  async listByRole(role) {
    return db.collection("users").find({ role }).sort({ created_at: 1 }).toArray();
  },
  async updatePassword(id, passwordHash) {
    await db.collection("users").updateOne({ _id: oid(id) }, { $set: { password_hash: passwordHash, updated_at: nowISO() } });
  },
  async list() {
    return db.collection("users").find().sort({ created_at: -1 }).toArray();
  },
  async remove(id) {
    return (await db.collection("users").deleteOne({ _id: oid(id) })).deletedCount > 0;
  },
};

const tokens = {
  async create({ userId, tokenHash, type, expiresAt }) {
    await insertOne("tokens", { user_id: userId, token_hash: tokenHash, type, expires_at: expiresAt, used: 0, created_at: nowISO() });
  },
  async findValid(tokenHash, type) {
    return (
      (await db.collection("tokens").findOne({ token_hash: tokenHash, type, used: 0, expires_at: { $gt: nowISO() } })) || null
    );
  },
  async markUsed(id) {
    await db.collection("tokens").updateOne({ _id: oid(id) }, { $set: { used: 1 } });
  },
  async deleteByUser(userId, type) {
    await db.collection("tokens").deleteMany({ user_id: userId, type });
  },
};

const sessions = {
  async create({ userId, tokenHash, expiresAt }) {
    await insertOne("sessions", { user_id: userId, token_hash: tokenHash, expires_at: expiresAt, revoked: 0, created_at: nowISO() });
  },
  async findValid(tokenHash) {
    return (
      (await db.collection("sessions").findOne({ token_hash: tokenHash, revoked: 0, expires_at: { $gt: nowISO() } })) || null
    );
  },
  async revoke(id) {
    await db.collection("sessions").updateOne({ _id: oid(id) }, { $set: { revoked: 1 } });
  },
  async revokeAllForUser(userId) {
    await db.collection("sessions").updateMany({ user_id: userId }, { $set: { revoked: 1 } });
  },
};

const enquiries = {
  async create(v) {
    const row = await insertOne("enquiries", { ...v, status: "new", created_at: nowISO() });
    return { ...row, id: String(row._id) };
  },
  async list(status) {
    const filter = status ? { status } : {};
    return db.collection("enquiries").find(filter).sort({ created_at: -1 }).toArray();
  },
  async get(id) {
    try {
      return await db.collection("enquiries").findOne({ _id: oid(id) });
    } catch {
      return null;
    }
  },
  async setStatus(id, status) {
    return (await db.collection("enquiries").updateOne({ _id: oid(id) }, { $set: { status } })).modifiedCount > 0;
  },
  async remove(id) {
    return (await db.collection("enquiries").deleteOne({ _id: oid(id) })).deletedCount > 0;
  },
  async stats() {
    const total = await db.collection("enquiries").countDocuments();
    const by = async (s) => db.collection("enquiries").countDocuments({ status: s });
    return { total, new: await by("new"), contacted: await by("contacted"), closed: await by("closed") };
  },
};

const listings = {
  async list({ includeSold = false, level } = {}) {
    const filter = {};
    if (!includeSold) filter.status = "available";
    if (level !== undefined && level !== null && level !== "") filter.level = Number(level);
    return db.collection("listings").find(filter).sort({ created_at: -1 }).toArray();
  },
  async get(id) {
    try {
      return await db.collection("listings").findOne({ _id: oid(id) });
    } catch {
      return null;
    }
  },
  async create(v) {
    const row = await insertOne("listings", {
      title: v.title,
      description: v.description,
      price: v.price,
      level: v.level ?? null,
      tech_stack: v.tech_stack ?? null,
      status: v.status ?? "available",
      thumbnail: v.thumbnail ?? null,
      delivery_url: v.delivery_url ?? v.deliveryUrl ?? null,
      employee_id: v.employee_id ?? null,
      created_at: nowISO(),
    });
    return { ...row, id: String(row._id) };
  },
  async update(id, patch) {
    const allowed = ["title", "description", "price", "level", "tech_stack", "status", "thumbnail", "delivery_url", "employee_id"];
    const set = {};
    for (const k of allowed) if (k in patch) set[k] = patch[k] === undefined ? null : patch[k];
    if (!Object.keys(set).length) return this.get(id);
    await db.collection("listings").updateOne({ _id: oid(id) }, { $set: set });
    return this.get(id);
  },
  async listForEmployee(employeeId) {
    return db.collection("listings").find({ employee_id: employeeId }).sort({ created_at: -1 }).toArray();
  },
  async unassignEmployee(employeeId) {
    return (await db.collection("listings").updateMany({ employee_id: employeeId }, { $set: { employee_id: null } })).modifiedCount;
  },
  async remove(id) {
    return (await db.collection("listings").deleteOne({ _id: oid(id) })).deletedCount > 0;
  },
  async stats() {
    const total = await db.collection("listings").countDocuments();
    const availableDocs = await db.collection("listings").find({ status: "available" }).toArray();
    const sold = await db.collection("listings").countDocuments({ status: "sold" });
    const inventoryValue = availableDocs.reduce((sum, l) => sum + (Number(l.price) || 0), 0);
    return { total, available: availableDocs.length, sold, inventoryValue };
  },
};

const subscribers = {
  async findByEmail(email) {
    return db.collection("subscribers").findOne({ email: String(email).toLowerCase() });
  },
  async activate(email) {
    return (await db.collection("subscribers").updateOne({ email: String(email).toLowerCase() }, { $set: { active: 1 } })).modifiedCount > 0;
  },
  async create(email) {
    await insertOne("subscribers", { email: String(email).toLowerCase(), active: 1, created_at: nowISO() });
  },
  async deactivate(email) {
    return (await db.collection("subscribers").updateOne({ email: String(email).toLowerCase() }, { $set: { active: 0 } })).modifiedCount > 0;
  },
  async listActive() {
    return db
      .collection("subscribers")
      .find({ active: 1 }, { projection: { _id: 1, email: 1, created_at: 1 } })
      .sort({ created_at: -1 })
      .toArray();
  },
  async countActive() {
    return db.collection("subscribers").countDocuments({ active: 1 });
  },
};

const orders = {
  async create(v) {
    const row = await insertOne("orders", {
      user_id: v.userId ?? null,
      listing_id: v.listingId ?? null,
      reference: v.reference,
      title: v.title,
      amount: v.amount,
      currency: v.currency || "NGN",
      email: v.email,
      name: v.name ?? null,
      status: "pending",
      paid_at: null,
      created_at: nowISO(),
    });
    return { ...row, id: String(row._id) };
  },
  async findByReference(reference) {
    return db.collection("orders").findOne({ reference }) || null;
  },
  async getById(id) {
    try {
      return await db.collection("orders").findOne({ _id: oid(id) });
    } catch {
      return null;
    }
  },
  async markPaid(reference, paidAt) {
    return (await db.collection("orders").updateOne({ reference }, { $set: { status: "paid", paid_at: paidAt } })).modifiedCount > 0;
  },
  async markFailed(reference) {
    return (
      (await db.collection("orders").updateOne({ reference, status: "pending" }, { $set: { status: "failed" } })).modifiedCount > 0
    );
  },
  async listForUser(userId) {
    return db.collection("orders").find({ user_id: userId }).sort({ created_at: -1 }).toArray();
  },
  async listAll(status) {
    const filter = status ? { status } : {};
    return db.collection("orders").find(filter).sort({ created_at: -1 }).toArray();
  },
  async stats() {
    const total = await db.collection("orders").countDocuments();
    const by = async (s) => db.collection("orders").countDocuments({ status: s });
    const paidDocs = await db.collection("orders").find({ status: "paid" }).toArray();
    return {
      total,
      paid: await by("paid"),
      pending: await by("pending"),
      failed: await by("failed"),
      revenue: paidDocs.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
    };
  },
};

const credentials = {
  async create(v) {
    const row = await insertOne("webauthn_credentials", {
      user_id: v.userId,
      credential_id: v.credentialId,
      public_key: v.publicKey,
      counter: v.counter || 0,
      device_type: v.deviceType ?? null,
      backed_up: v.backedUp ? 1 : 0,
      created_at: nowISO(),
    });
    return { ...row, id: String(row._id) };
  },
  async findByCredentialId(credentialId) {
    return db.collection("webauthn_credentials").findOne({ credential_id: credentialId }) || null;
  },
  async listForUser(userId) {
    return db.collection("webauthn_credentials").find({ user_id: userId }).sort({ created_at: -1 }).toArray();
  },
  async updateCounter(id, counter) {
    const { ObjectId } = require("mongodb");
    return (
      (
        await db
          .collection("webauthn_credentials")
          .updateOne({ _id: new ObjectId(id) }, { $set: { counter } })
      ).modifiedCount > 0
    );
  },
  async remove(id) {
    const { ObjectId } = require("mongodb");
    return (await db.collection("webauthn_credentials").deleteOne({ _id: new ObjectId(id) })).deletedCount > 0;
  },
};

const api = {
  name: "mongo",
  users,
  tokens,
  sessions,
  enquiries,
  listings,
  subscribers,
  orders,
  credentials,
  _publicUser: toPublic,
  _close: () => client && client.close(),
};

module.exports = { init };
