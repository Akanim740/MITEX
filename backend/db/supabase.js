let supabase;

function toPublic(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

async function init() {
  let createClient;
  try {
    ({ createClient } = require("@supabase/supabase-js"));
  } catch {
    throw new Error("Supabase client not installed. Run: npm install @supabase/supabase-js");
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env when DB_CLIENT=supabase");
  }

  supabase = createClient(url, key, { auth: { persistSession: false } });

  const { error } = await supabase.from("users").select("id").limit(1);
  if (error && error.code === "42P01") {
    throw new Error(
      "Supabase tables not found. Run the SQL in backend/db/schema.sql (Postgres section) in your Supabase SQL editor."
    );
  }

  return api;
}

const nowISO = () => new Date().toISOString();

const users = {
  async count() {
    const { count } = await supabase.from("users").select("id", { count: "exact", head: true });
    return count || 0;
  },
  async findByEmail(email) {
    const { data } = await supabase.from("users").select("*").eq("email", String(email).toLowerCase()).maybeSingle();
    return data || null;
  },
  async findById(id) {
    const { data } = await supabase.from("users").select("*").eq("id", id).maybeSingle();
    return data || null;
  },
  async create({ name, email, passwordHash, role = "customer", emailVerified = 0, phone = null, bio = null, avatar_url = null, active, country = "NG", locale = "en", dob = null, nin_bvn = null, nin_file = null, payment_enc = null }) {
    const { data, error } = await supabase
      .from("users")
      .insert({
        name,
        email: String(email).toLowerCase(),
        password_hash: passwordHash,
        role,
        email_verified: !!emailVerified,
        phone,
        bio,
        avatar_url,
        active: active === undefined ? true : !!active,
        country,
        locale,
        dob,
        nin_bvn,
        nin_file,
        payment_enc,
        created_at: nowISO(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const allowed = ["name", "phone", "bio", "avatar_url", "role", "email_verified", "active", "country", "locale", "dob", "nin_bvn", "nin_file", "payment_enc"];
    const set = {};
    for (const k of allowed) if (k in patch) set[k] = patch[k];
    set.updated_at = nowISO();
    const { data, error } = await supabase.from("users").update(set).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async countByRole(role) {
    const { count } = await supabase.from("users").select("id", { count: "exact", head: true }).eq("role", role);
    return count || 0;
  },
  async listByRole(role) {
    const { data } = await supabase.from("users").select("*").eq("role", role).order("created_at", { ascending: true });
    return data || [];
  },
  async updatePassword(id, passwordHash) {
    const { error } = await supabase
      .from("users")
      .update({ password_hash: passwordHash, updated_at: nowISO() })
      .eq("id", id);
    if (error) throw error;
  },
  async list() {
    const { data } = await supabase.from("users").select("*").order("created_at", { ascending: false });
    return data || [];
  },
  async remove(id) {
    const { error } = await supabase.from("users").delete().eq("id", id);
    return !error;
  },
};

const tokens = {
  async create({ userId, tokenHash, type, expiresAt }) {
    const { error } = await supabase
      .from("tokens")
      .insert({ user_id: userId, token_hash: tokenHash, type, expires_at: expiresAt, used: false, created_at: nowISO() });
    if (error) throw error;
  },
  async findValid(tokenHash, type) {
    const { data } = await supabase
      .from("tokens")
      .select("*")
      .eq("token_hash", tokenHash)
      .eq("type", type)
      .eq("used", false)
      .gt("expires_at", nowISO())
      .maybeSingle();
    return data || null;
  },
  async markUsed(id) {
    await supabase.from("tokens").update({ used: true }).eq("id", id);
  },
  async deleteByUser(userId, type) {
    await supabase.from("tokens").delete().eq("user_id", userId).eq("type", type);
  },
};

const sessions = {
  async create({ userId, tokenHash, expiresAt }) {
    const { error } = await supabase
      .from("sessions")
      .insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt, revoked: false, created_at: nowISO() });
    if (error) throw error;
  },
  async findValid(tokenHash) {
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq("token_hash", tokenHash)
      .eq("revoked", false)
      .gt("expires_at", nowISO())
      .maybeSingle();
    return data || null;
  },
  async revoke(id) {
    await supabase.from("sessions").update({ revoked: true }).eq("id", id);
  },
  async revokeAllForUser(userId) {
    await supabase.from("sessions").update({ revoked: true }).eq("user_id", userId);
  },
};

const enquiries = {
  async create(v) {
    const { data, error } = await supabase
      .from("enquiries")
      .insert({ ...v, status: "new", created_at: nowISO() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async list(status) {
    let query = supabase.from("enquiries").select("*").order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data } = await query;
    return data || [];
  },
  async get(id) {
    const { data } = await supabase.from("enquiries").select("*").eq("id", id).maybeSingle();
    return data || null;
  },
  async setStatus(id, status) {
    const { error } = await supabase.from("enquiries").update({ status }).eq("id", id);
    return !error;
  },
  async remove(id) {
    const { error } = await supabase.from("enquiries").delete().eq("id", id);
    return !error;
  },
  async stats() {
    const total = await this._count();
    const by = async (s) => {
      const { count } = await supabase.from("enquiries").select("id", { count: "exact", head: true }).eq("status", s);
      return count || 0;
    };
    return { total, new: await by("new"), contacted: await by("contacted"), closed: await by("closed") };
  },
  async _count() {
    const { count } = await supabase.from("enquiries").select("id", { count: "exact", head: true });
    return count || 0;
  },
};

const listings = {
  async list({ includeSold = false, level } = {}) {
    let query = supabase.from("listings").select("*").order("created_at", { ascending: false });
    if (!includeSold) query = query.eq("status", "available");
    if (level !== undefined && level !== null && level !== "") query = query.eq("level", Number(level));
    const { data } = await query;
    return data || [];
  },
  async get(id) {
    const { data } = await supabase.from("listings").select("*").eq("id", id).maybeSingle();
    return data || null;
  },
  async create(v) {
    const { data, error } = await supabase
      .from("listings")
      .insert({
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
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const allowed = ["title", "description", "price", "level", "tech_stack", "status", "thumbnail", "delivery_url", "employee_id"];
    const set = {};
    for (const k of allowed) if (k in patch) set[k] = patch[k] === undefined ? null : patch[k];
    const { data, error } = await supabase.from("listings").update(set).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async listForEmployee(employeeId) {
    const { data } = await supabase
      .from("listings")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    return data || [];
  },
  async unassignEmployee(employeeId) {
    const { data, error } = await supabase
      .from("listings")
      .update({ employee_id: null })
      .eq("employee_id", employeeId)
      .select("id");
    if (error) throw error;
    return (data || []).length;
  },
  async remove(id) {
    const { error } = await supabase.from("listings").delete().eq("id", id);
    return !error;
  },
  async stats() {
    const available = await this.list({ includeSold: true }).then((rows) => rows.filter((r) => r.status === "available"));
    const total = await supabase.from("listings").select("id", { count: "exact", head: true }).then(({ count }) => count || 0);
    const sold = await supabase
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("status", "sold")
      .then(({ count }) => count || 0);
    return {
      total,
      available: available.length,
      sold,
      inventoryValue: available.reduce((sum, l) => sum + (Number(l.price) || 0), 0),
    };
  },
};

const subscribers = {
  async findByEmail(email) {
    const { data } = await supabase.from("subscribers").select("*").eq("email", String(email).toLowerCase()).maybeSingle();
    return data || null;
  },
  async activate(email) {
    const { error } = await supabase.from("subscribers").update({ active: true }).eq("email", String(email).toLowerCase());
    return !error;
  },
  async create(email) {
    const { error } = await supabase
      .from("subscribers")
      .insert({ email: String(email).toLowerCase(), active: true, created_at: nowISO() });
    if (error) throw error;
  },
  async deactivate(email) {
    const { error } = await supabase.from("subscribers").update({ active: false }).eq("email", String(email).toLowerCase());
    return !error;
  },
  async listActive() {
    const { data } = await supabase
      .from("subscribers")
      .select("id, email, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false });
    return data || [];
  },
  async countActive() {
    const { count } = await supabase.from("subscribers").select("id", { count: "exact", head: true }).eq("active", true);
    return count || 0;
  },
};

const orders = {
  async create(v) {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        user_id: v.userId ?? null,
        listing_id: v.listingId ?? null,
        reference: v.reference,
        title: v.title,
        amount: v.amount,
        currency: v.currency || "NGN",
        email: v.email,
        name: v.name ?? null,
        notes: v.notes ?? null,
        status: "pending",
        created_at: nowISO(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async findByReference(reference) {
    const { data } = await supabase.from("orders").select("*").eq("reference", reference).maybeSingle();
    return data || null;
  },
  async getById(id) {
    const { data } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
    return data || null;
  },
  async markPaid(reference, paidAt) {
    const { error } = await supabase.from("orders").update({ status: "paid", paid_at: paidAt }).eq("reference", reference);
    return !error;
  },
  async markFailed(reference) {
    const { error } = await supabase.from("orders").update({ status: "failed" }).eq("reference", reference).eq("status", "pending");
    return !error;
  },
  async updateStatus(reference, status) {
    const { error } = await supabase.from("orders").update({ status }).eq("reference", reference);
    return !error;
  },
  async listForUser(userId) {
    const { data } = await supabase.from("orders").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    return data || [];
  },
  async listAll(status) {
    let query = supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data } = await query;
    return data || [];
  },
  async stats() {
    const all = (await supabase.from("orders").select("amount, status")).data || [];
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
    const { data, error } = await supabase
      .from("webauthn_credentials")
      .insert({
        user_id: v.userId,
        credential_id: v.credentialId,
        public_key: v.publicKey,
        counter: v.counter || 0,
        device_type: v.deviceType ?? null,
        backed_up: v.backedUp ? 1 : 0,
        created_at: nowISO(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async findByCredentialId(credentialId) {
    const { data } = await supabase.from("webauthn_credentials").select("*").eq("credential_id", credentialId).maybeSingle();
    return data || null;
  },
  async listForUser(userId) {
    const { data } = await supabase
      .from("webauthn_credentials")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    return data || [];
  },
  async updateCounter(id, counter) {
    const { error } = await supabase.from("webauthn_credentials").update({ counter }).eq("id", id);
    return !error;
  },
  async remove(id) {
    const { error } = await supabase.from("webauthn_credentials").delete().eq("id", id);
    return !error;
  },
};

const applications = {
  async create(v) {
    const { data, error } = await supabase
      .from("applications")
      .insert({
        name: v.name,
        email: String(v.email).toLowerCase(),
        phone: v.phone ?? null,
        portfolio: v.portfolio ?? null,
        message: v.message,
        dob: v.dob ?? null,
        nin_bvn: v.nin_bvn ?? null,
        status: "new",
        created_at: nowISO(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async findByEmail(email) {
    const { data } = await supabase
      .from("applications")
      .select("*")
      .eq("email", String(email).toLowerCase())
      .neq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  },
  async get(id) {
    const { data } = await supabase.from("applications").select("*").eq("id", id).maybeSingle();
    return data || null;
  },
  async getByTestToken(token) {
    const { data } = await supabase.from("applications").select("*").eq("test_token", token).maybeSingle();
    return data || null;
  },
  async getByHireToken(token) {
    const { data } = await supabase
      .from("applications")
      .select("*")
      .eq("hire_token", token)
      .eq("hire_completed", false)
      .maybeSingle();
    return data || null;
  },
  async list(status) {
    let query = supabase.from("applications").select("*").order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data } = await query;
    return data || [];
  },
  async setTest(id, { testToken, instructions }) {
    const { data, error } = await supabase
      .from("applications")
      .update({ status: "test_sent", test_token: testToken, test_instructions: instructions, test_sent_at: nowISO() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async setSubmission(id, { url, notes }) {
    const { data, error } = await supabase
      .from("applications")
      .update({ status: "submitted", submit_url: url, submit_notes: notes ?? null, submitted_at: nowISO() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async setPayDetails(id, enc) {
    const { data, error } = await supabase.from("applications").update({ payment_enc: enc }).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async markHired(id, { staffUserId, hireToken }) {
    const { data, error } = await supabase
      .from("applications")
      .update({ status: "passed", staff_user_id: String(staffUserId), hire_token: hireToken })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async completeHire(id) {
    const { error } = await supabase.from("applications").update({ hire_completed: true }).eq("id", id);
    if (error) throw error;
  },
  async setStatus(id, status) {
    const { error } = await supabase.from("applications").update({ status }).eq("id", id);
    return !error;
  },
  async remove(id) {
    const { error } = await supabase.from("applications").delete().eq("id", id);
    return !error;
  },
};

const salaries = {
  async create(v) {
    const { data, error } = await supabase
      .from("salaries")
      .insert({
        staff_user_id: String(v.staffUserId),
        amount: Math.round(v.amount),
        bonus: Math.round(v.bonus || 0),
        period: v.period,
        note: v.note ?? null,
        paid_at: nowISO(),
        created_at: nowISO(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async getById(id) {
    const { data } = await supabase.from("salaries").select("*").eq("id", id).maybeSingle();
    return data || null;
  },
  async listForStaff(staffUserId) {
    const { data } = await supabase
      .from("salaries")
      .select("*")
      .eq("staff_user_id", String(staffUserId))
      .order("created_at", { ascending: false });
    return data || [];
  },
  async listAll(period) {
    let query = supabase.from("salaries").select("*").order("created_at", { ascending: false });
    if (period) query = query.eq("period", period);
    const { data } = await query;
    return data || [];
  },
  async totalForPeriod(period) {
    const { data } = await supabase.from("salaries").select("amount, bonus").eq("period", period);
    return (data || []).reduce((sum, r) => sum + Number(r.amount || 0) + Number(r.bonus || 0), 0);
  },
  async remove(id) {
    const { error } = await supabase.from("salaries").delete().eq("id", id);
    return !error;
  },
};

const audit = {
  async log({ userId, email, action, detail, ip }) {
    await supabase.from("audit_logs").insert({ user_id: userId || null, email: email || null, action, detail: detail || null, ip: ip || null });
  },
  async list(limit = 100) {
    const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(limit);
    return error ? [] : data || [];
  },
};

const buyIntents = {
  async get(userId, listingId) {
    const { data } = await supabase.from("buy_intents").select("*").eq("user_id", userId).eq("listing_id", String(listingId)).maybeSingle();
    return data || null;
  },
  async create({ userId, listingId }) {
    const existing = await this.get(userId, listingId);
    if (existing) {
      if (existing.status !== "waiting") {
        const { data, error } = await supabase.from("buy_intents").update({ status: "waiting", updated_at: nowISO() }).eq("id", existing.id).select().single();
        if (!error) return data;
      }
      return existing;
    }
    const { data, error } = await supabase
      .from("buy_intents")
      .insert({ user_id: userId, listing_id: String(listingId), status: "waiting", created_at: nowISO() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async listWaitingByListing(listingId) {
    const { data, error } = await supabase.from("buy_intents").select("*").eq("listing_id", String(listingId)).eq("status", "waiting").order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },
  async setStatus(id, status) {
    await supabase.from("buy_intents").update({ status, updated_at: nowISO() }).eq("id", id);
  },
  async remove(id) {
    const { error } = await supabase.from("buy_intents").delete().eq("id", id);
    return !error;
  },
};

const pushSubs = {
  async add({ userId, endpoint, p256dh, auth }) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    const { data, error } = await supabase
      .from("push_subscriptions")
      .insert({ user_id: userId, endpoint, p256dh, auth, created_at: nowISO() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async listByUser(userId) {
    const { data, error } = await supabase.from("push_subscriptions").select("*").eq("user_id", userId);
    if (error) throw error;
    return data || [];
  },
  async removeByEndpoint(endpoint) {
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    return !error;
  },
};

const notifications = {
  async create({ userId, type, title, body, link }) {
    const { data, error } = await supabase
      .from("notifications")
      .insert({ user_id: userId, type, title, body: body || null, link: link || null, read: false, created_at: nowISO() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async listForUser(userId, limit = 50) {
    const { data, error } = await supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  },
  async unreadCount(userId) {
    const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("read", false);
    if (error) throw error;
    return count || 0;
  },
  async markRead(userId, id) {
    if (id) await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("id", id);
    else await supabase.from("notifications").update({ read: true }).eq("user_id", userId);
  },
};

const api = {
  name: "supabase",
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
  buyIntents,
  pushSubs,
  notifications,
  _publicUser: toPublic,
};

module.exports = { init };
