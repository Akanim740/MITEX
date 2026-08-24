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
  async create({ name, email, passwordHash, role = "customer", emailVerified = 0, phone = null, bio = null, avatar_url = null, active }) {
    return addDoc("users", {
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
    });
  },
  async update(id, patch) {
    const allowed = ["name", "phone", "bio", "avatar_url", "role", "email_verified", "active"];
    const set = { updated_at: nowISO() };
    for (const k of allowed) if (k in patch) set[k] = typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : patch[k];
    await col("users").doc(String(id)).update(set);
    return this.findById(id);
  },
  async countByRole(role) {
    const snap = await col("users").where("role", "==", role).count().get();
    return snap.data().count || 0;
  },
  async listByRole(role) {
    const snap = await col("users").where("role", "==", role).get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
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
      delivery_url: v.delivery_url ?? v.deliveryUrl ?? null,
      employee_id: v.employee_id ?? null,
      created_at: nowISO(),
    });
  },
  async update(id, patch) {
    const allowed = ["title", "description", "price", "level", "tech_stack", "status", "thumbnail", "delivery_url", "employee_id"];
    const set = {};
    for (const k of allowed) if (k in patch) set[k] = patch[k] === undefined ? null : patch[k];
    await col("listings").doc(String(id)).update(set);
    return this.get(id);
  },
  async listForEmployee(employeeId) {
    const snap = await col("listings").where("employee_id", "==", employeeId).get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  },
  async unassignEmployee(employeeId) {
    const snap = await col("listings").where("employee_id", "==", employeeId).get();
    const batch = firestore.batch();
    snap.docs.forEach((d) => batch.update(d.ref, { employee_id: null }));
    await batch.commit();
    return snap.size;
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

const applications = {
  async create(v) {
    return addDoc("applications", {
      name: v.name,
      email: String(v.email).toLowerCase(),
      phone: v.phone ?? null,
      portfolio: v.portfolio ?? null,
      message: v.message,
      status: "new",
      test_token: null,
      test_instructions: null,
      test_sent_at: null,
      submit_url: null,
      submit_notes: null,
      submitted_at: null,
      staff_user_id: null,
      hire_token: null,
      hire_completed: 0,
      created_at: nowISO(),
    });
  },
  async findByEmail(email) {
    const snap = await col("applications").where("email", "==", String(email).toLowerCase()).get();
    const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((r) => r.status !== "rejected");
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return rows[0] || null;
  },
  async get(id) {
    const d = await col("applications").doc(String(id)).get();
    return d.exists ? { ...d.data(), id: d.id } : null;
  },
  async getByTestToken(token) {
    const snap = await col("applications").where("test_token", "==", token).limit(1).get();
    return snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id };
  },
  async getByHireToken(token) {
    const snap = await col("applications").where("hire_token", "==", token).where("hire_completed", "==", 0).limit(1).get();
    return snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id };
  },
  async list(status) {
    let query = col("applications");
    if (status) query = query.where("status", "==", status);
    const snap = await query.get();
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  },
  async setTest(id, { testToken, instructions }) {
    await col("applications").doc(String(id)).update({
      status: "test_sent",
      test_token: testToken,
      test_instructions: instructions,
      test_sent_at: nowISO(),
    });
    return this.get(id);
  },
  async setSubmission(id, { url, notes }) {
    await col("applications").doc(String(id)).update({
      status: "submitted",
      submit_url: url,
      submit_notes: notes ?? null,
      submitted_at: nowISO(),
    });
    return this.get(id);
  },
  async markHired(id, { staffUserId, hireToken }) {
    await col("applications").doc(String(id)).update({
      status: "passed",
      staff_user_id: String(staffUserId),
      hire_token: hireToken,
    });
    return this.get(id);
  },
  async completeHire(id) {
    await col("applications").doc(String(id)).update({ hire_completed: 1 });
  },
  async setStatus(id, status) {
    await col("applications").doc(String(id)).update({ status });
    return true;
  },
  async remove(id) {
    await col("applications").doc(String(id)).delete();
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
  applications,
  _publicUser: toPublic,
};

module.exports = { init };
