let admin;
let firestore;

function toPublic(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

async function init() {
  try {
    admin = require("firebase-admin");
  } catch {
    throw new Error("firebase-admin not installed. Run: npm install firebase-admin");
  }

  if (!admin.apps.length) {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountPath) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT must point to your service-account JSON when DB_CLIENT=firebase");
    }
    // eslint-disable-next-line global-require
    const serviceAccount = require(require("path").resolve(serviceAccountPath));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  firestore = admin.firestore();
  return api;
}

const nowISO = () => new Date().toISOString();
const col = (name) => firestore.collection(name);

async function addDoc(collection, doc) {
  const ref = await col(collection).add(doc);
  return { ...doc, id: ref.id };
}

const users = {
  async count() {
    const snap = await col("users").select().get();
    return snap.size;
  },
  async findByEmail(email) {
    const snap = await col("users").where("email", "==", String(email).toLowerCase()).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { ...d.data(), id: d.id };
  },
  async findById(id) {
    const d = await col("users").doc(String(id)).get();
    return d.exists ? { ...d.data(), id: d.id } : null;
  },
  async create({ name, email, passwordHash, role = "customer", emailVerified = 0 }) {
    return addDoc("users", {
      name,
      email: String(email).toLowerCase(),
      password_hash: passwordHash,
      role,
      email_verified: emailVerified ? 1 : 0,
      phone: null,
      bio: null,
      avatar_url: null,
      created_at: nowISO(),
      updated_at: null,
    });
  },
  async update(id, patch) {
    const allowed = ["name", "phone", "bio", "avatar_url", "role", "email_verified"];
    const set = { updated_at: nowISO() };
    for (const k of allowed) if (k in patch) set[k] = typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : patch[k];
    await col("users").doc(String(id)).update(set);
    return this.findById(id);
  },
  async updatePassword(id, passwordHash) {
    await col("users").doc(String(id)).update({ password_hash: passwordHash, updated_at: nowISO() });
  },
  async list() {
    const snap = await col("users").orderBy("created_at", "desc").get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  },
  async remove(id) {
    await col("users").doc(String(id)).delete();
    return true;
  },
};

const tokens = {
  async create({ userId, tokenHash, type, expiresAt }) {
    await addDoc("tokens", { user_id: userId, token_hash: tokenHash, type, expires_at: expiresAt, used: 0, created_at: nowISO() });
  },
  async findValid(tokenHash, type) {
    const snap = await col("tokens").where("token_hash", "==", tokenHash).where("type", "==", type).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    const row = { ...d.data(), id: d.id };
    if (row.used || row.expires_at <= nowISO()) return null;
    return row;
  },
  async markUsed(id) {
    await col("tokens").doc(String(id)).update({ used: 1 });
  },
  async deleteByUser(userId, type) {
    const snap = await col("tokens").where("user_id", "==", userId).where("type", "==", type).get();
    const batch = firestore.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  },
};

const sessions = {
  async create({ userId, tokenHash, expiresAt }) {
    await addDoc("sessions", { user_id: userId, token_hash: tokenHash, expires_at: expiresAt, revoked: 0, created_at: nowISO() });
  },
  async findValid(tokenHash) {
    const snap = await col("sessions").where("token_hash", "==", tokenHash).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    const row = { ...d.data(), id: d.id };
    if (row.revoked || row.expires_at <= nowISO()) return null;
    return row;
  },
  async revoke(id) {
    await col("sessions").doc(String(id)).update({ revoked: 1 });
  },
  async revokeAllForUser(userId) {
    const snap = await col("sessions").where("user_id", "==", userId).where("revoked", "==", 0).get();
    const batch = firestore.batch();
    snap.docs.forEach((d) => batch.update(d.ref, { revoked: 1 }));
    await batch.commit();
  },
};

const enquiries = {
  async create(v) {
    return addDoc("enquiries", { ...v, status: "new", created_at: nowISO() });
  },
  async list(status) {
    let q = col("enquiries").orderBy("created_at", "desc");
    if (status) q = col("enquiries").where("status", "==", status).orderBy("created_at", "desc");
    const snap = await q.get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  },
  async get(id) {
    const d = await col("enquiries").doc(String(id)).get();
    return d.exists ? { ...d.data(), id: d.id } : null;
  },
  async setStatus(id, status) {
    await col("enquiries").doc(String(id)).update({ status });
    return true;
  },
  async remove(id) {
    await col("enquiries").doc(String(id)).delete();
    return true;
  },
  async stats() {
    const by = async (s) => (await col("enquiries").where("status", "==", s).select().get()).size;
    return {
      total: (await col("enquiries").select().get()).size,
      new: await by("new"),
      contacted: await by("contacted"),
      closed: await by("closed"),
    };
  },
};

const listings = {
  async list({ includeSold = false, level } = {}) {
    let rows = (await col("listings").orderBy("created_at", "desc").get()).docs.map((d) => ({ ...d.data(), id: d.id }));
    if (!includeSold) rows = rows.filter((r) => r.status === "available");
    if (level !== undefined && level !== null && level !== "") rows = rows.filter((r) => r.level === Number(level));
    return rows;
  },
  async get(id) {
    const d = await col("listings").doc(String(id)).get();
    return d.exists ? { ...d.data(), id: d.id } : null;
  },
  async create(v) {
    return addDoc("listings", {
      title: v.title,
      description: v.description,
      price: v.price,
      level: v.level ?? null,
      tech_stack: v.tech_stack ?? null,
      status: v.status ?? "available",
      thumbnail: v.thumbnail ?? null,
      delivery_url: v.deliveryUrl ?? null,
      created_at: nowISO(),
    });
  },
  async update(id, patch) {
    const allowed = ["title", "description", "price", "level", "tech_stack", "status", "thumbnail", "delivery_url"];
    const set = {};
    for (const k of allowed) if (k in patch) set[k] = patch[k] === undefined ? null : patch[k];
    await col("listings").doc(String(id)).update(set);
    return this.get(id);
  },
  async remove(id) {
    await col("listings").doc(String(id)).delete();
    return true;
  },
  async stats() {
    const all = (await col("listings").select().get()).docs.map((d) => ({ ...d.data(), id: d.id }));
    const available = all.filter((l) => l.status === "available");
    return {
      total: all.length,
      available: available.length,
      sold: all.filter((l) => l.status === "sold").length,
      inventoryValue: available.reduce((sum, l) => sum + (Number(l.price) || 0), 0),
    };
  },
};

const subscribers = {
  async findByEmail(email) {
    const snap = await col("subscribers").where("email", "==", String(email).toLowerCase()).limit(1).get();
    return snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id };
  },
  async activate(email) {
    const row = await this.findByEmail(email);
    if (!row) return false;
    await col("subscribers").doc(row.id).update({ active: 1 });
    return true;
  },
  async create(email) {
    await addDoc("subscribers", { email: String(email).toLowerCase(), active: 1, created_at: nowISO() });
  },
  async deactivate(email) {
    const row = await this.findByEmail(email);
    if (!row) return false;
    await col("subscribers").doc(row.id).update({ active: 0 });
    return true;
  },
  async listActive() {
    const snap = await col("subscribers").where("active", "==", 1).get();
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map(({ id, email, created_at }) => ({ id, email, created_at }));
  },
  async countActive() {
    return (await col("subscribers").where("active", "==", 1).select().get()).size;
  },
};

const orders = {
  async create(v) {
    return addDoc("orders", {
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
  },
  async findByReference(reference) {
    const snap = await col("orders").where("reference", "==", reference).limit(1).get();
    return snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id };
  },
  async getById(id) {
    const d = await col("orders").doc(String(id)).get();
    return d.exists ? { ...d.data(), id: d.id } : null;
  },
  async markPaid(reference, paidAt) {
    const row = await this.findByReference(reference);
    if (!row) return false;
    await col("orders").doc(row.id).update({ status: "paid", paid_at: paidAt });
    return true;
  },
  async markFailed(reference) {
    const row = await this.findByReference(reference);
    if (!row || row.status !== "pending") return false;
    await col("orders").doc(row.id).update({ status: "failed" });
    return true;
  },
  async listForUser(userId) {
    const snap = await col("orders").where("user_id", "==", userId).get();
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  },
  async listAll(status) {
    let rows = (await col("orders").orderBy("created_at", "desc").get()).docs.map((d) => ({ ...d.data(), id: d.id }));
    if (status) rows = rows.filter((r) => r.status === status);
    return rows;
  },
  async stats() {
    const all = (await col("orders").select().get()).docs.map((d) => ({ ...d.data(), id: d.id }));
    const by = (s) => all.filter((o) => o.status === s).length;
    return {
      total: all.length,
      paid: by("paid"),
      pending: by("pending"),
      failed: by("failed"),
      revenue: all.filter((o) => o.status === "paid").reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
    };
  },
};

const credentials = {
  async create(v) {
    return addDoc("webauthn_credentials", {
      user_id: v.userId,
      credential_id: v.credentialId,
      public_key: v.publicKey,
      counter: v.counter || 0,
      device_type: v.deviceType ?? null,
      backed_up: v.backedUp ? 1 : 0,
      created_at: nowISO(),
    });
  },
  async findByCredentialId(credentialId) {
    const snap = await col("webauthn_credentials").where("credential_id", "==", credentialId).limit(1).get();
    return snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id };
  },
  async listForUser(userId) {
    const snap = await col("webauthn_credentials").where("user_id", "==", userId).get();
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  },
  async updateCounter(id, counter) {
    await col("webauthn_credentials").doc(id).update({ counter });
    return true;
  },
  async remove(id) {
    await col("webauthn_credentials").doc(id).delete();
    return true;
  },
};

const api = {
  name: "firebase",
  users,
  tokens,
  sessions,
  enquiries,
  listings,
  subscribers,
  orders,
  credentials,
  _publicUser: toPublic,
};

module.exports = { init };
