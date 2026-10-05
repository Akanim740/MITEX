// MITEX AI persistence.
//
// One implementation of the AI state machine, driven by a small set of
// primitives each db adapter supplies. Adapters differ only in how they
// execute a query; the rules about what a project may do next live here, once.
//
// The state machine is the security-relevant part. A build is customer-paid
// work that will be handed over as a download, so it must never move to
// "released" without a confirmed payment, and a customer must never be able to
// move their own project to "released".

const STATUSES = ["draft", "building", "review", "approved", "rejected", "paid", "released", "deployed", "cancelled"];

// Who is allowed to perform each transition. "customer" transitions are the
// ones a customer is entitled to make on their own project; "admin" ones are
// staff-only and must be enforced by the caller as well as here.
const TRANSITIONS = {
  draft: ["building", "cancelled"],
  building: ["review", "failed", "cancelled"],
  review: ["approved", "rejected"],
  approved: ["paid", "cancelled"],
  rejected: ["building", "cancelled"],
  paid: ["released"],
  released: ["deployed"],
  deployed: [],
  failed: ["building", "cancelled"],
  cancelled: [],
};

const ADMIN_ONLY = new Set(["approved", "rejected", "released", "deployed"]);

const DDL_SQLITE = `
CREATE TABLE IF NOT EXISTS ai_projects (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'build' CHECK (kind IN ('build','fix')),
  title         TEXT NOT NULL,
  brief         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','building','review','approved','rejected','paid','released','deployed','failed','cancelled')),
  summary       TEXT,
  notes         TEXT,
  model         TEXT,
  stub          INTEGER NOT NULL DEFAULT 0,
  total_bytes   INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  price         INTEGER,
  currency      TEXT NOT NULL DEFAULT 'NGN',
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS ai_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  content    TEXT NOT NULL,
  bytes      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS ai_orders (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reference    TEXT NOT NULL UNIQUE,
  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'NGN',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  paid_at      TEXT,
  released_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT
);
CREATE TABLE IF NOT EXISTS ai_deploys (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  target_url TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','live','failed','removed')),
  live       INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_projects_user ON ai_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_projects_status ON ai_projects(status);
CREATE INDEX IF NOT EXISTS idx_ai_files_project ON ai_files(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_orders_project ON ai_orders(project_id);
`;

/**
 * Build the aiProjects store over a driver.
 *
 * driver must provide:
 *   exec(sql)                      -> void            (ddl, sqlite only)
 *   insert(table, row)             -> row
 *   update(table, id, patch)       -> bool
 *   findOne(table, id)             -> row | null
 *   find(table, filter, opts)      -> row[]
 *   remove(table, id)              -> bool
 *   run(sql, params)               -> row            (sqlite only)
 */
function makeAiProjects(driver) {
  function newId(prefix) {
    const crypto = require("crypto");
    return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
  }
  function nowISO() {
    return new Date().toISOString();
  }

  function canTransition(from, to) {
    const allowed = TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.includes(to);
  }

  // Central gate for every status change. `role` decides who may perform
  // admin-only transitions; ownership decides who may touch it at all.
  function assertTransition(project, to, { role = "customer", actorId = null } = {}) {
    if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
    if (!canTransition(project.status, to)) {
      throw Object.assign(new Error(`Cannot move project from "${project.status}" to "${to}"`), {
        status: 409,
      });
    }
    if (ADMIN_ONLY.has(to) && role !== "admin") {
      throw Object.assign(new Error("Only staff can perform this step"), { status: 403 });
    }
    if (role !== "admin" && actorId != null && String(project.user_id) !== String(actorId)) {
      throw Object.assign(new Error("Not your project"), { status: 403 });
    }
    // Releasing a download is the one step that must be backed by money.
    if (to === "released") {
      throw Object.assign(
        new Error("Use release() so payment is verified before delivery"),
        { status: 400 }
      );
    }
    return true;
  }

  return {
    STATUSES,
    TRANSITIONS,
    ADMIN_ONLY,
    canTransition,

    async create({ userId = null, kind = "build", title, brief = "", price = null, currency = "NGN" } = {}) {
      const cleanTitle = String(title || "").trim().slice(0, 120);
      if (!cleanTitle) throw Object.assign(new Error("Title is required"), { status: 400 });
      if (!["build", "fix"].includes(kind)) {
        throw Object.assign(new Error("kind must be build or fix"), { status: 400 });
      }
      const row = {
        id: newId("aip"),
        user_id: userId,
        kind,
        title: cleanTitle,
        brief: String(brief || "").slice(0, 8000),
        status: "draft",
        currency,
        price: price == null ? null : Number(price),
        created_at: nowISO(),
      };
      return driver.insert("ai_projects", row);
    },

    async get(id) {
      return driver.findOne("ai_projects", id);
    },

    async listForUser(userId, { limit = 50 } = {}) {
      return driver.find("ai_projects", { user_id: userId }, { limit });
    },

    async listAll({ status = null, limit = 100 } = {}) {
      return driver.find("ai_projects", status ? { status } : {}, { limit });
    },

    async setStatus(id, to, opts = {}) {
      const project = await this.get(id);
      assertTransition(project, to, opts);
      return driver.update("ai_projects", id, { status: to, updated_at: nowISO(), error: null });
    },

    // Records the outcome of a build and stores its validated files. Files are
    // only ever written through here, so the validated bundle from
    // ai-builder is the only thing that can reach storage.
    async saveBuild(id, build, opts = {}) {
      const project = await this.get(id);
      assertTransition(project, build && build.ok ? "review" : "failed", opts);

      for (const f of (build && build.files) || []) {
        await driver.insert("ai_files", {
          project_id: id,
          path: f.path,
          content: f.content,
          bytes: f.bytes || Buffer.byteLength(f.content, "utf8"),
        });
      }

      const usage = (build && build.usage) || {};
      return driver.update("ai_projects", id, {
        status: build && build.ok ? "review" : "failed",
        summary: (build && build.summary) || null,
        notes: (build && build.notes) || null,
        model: (build && build.model) || null,
        stub: build && build.model && String(build.model).indexOf("stub") >= 0 ? 1 : 0,
        total_bytes: ((build && build.files) || []).reduce((n, f) => n + (f.bytes || 0), 0),
        input_tokens: usage.inputTokens || 0,
        output_tokens: usage.outputTokens || 0,
        error: build && build.ok ? null : String(((build || {}).errors || []).join("; ")).slice(0, 1000),
        updated_at: nowISO(),
      });
    },

    async listFiles(projectId) {
      return driver.find("ai_files", { project_id: projectId }, {});
    },

    // ---- orders -----------------------------------------------------------

    async createOrder(projectId, { amount, currency = "NGN" } = {}) {
      const project = await this.get(projectId);
      if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
      if (project.status !== "approved") {
        throw Object.assign(new Error("Project must be approved before payment is requested"), {
          status: 409,
        });
      }
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) {
        throw Object.assign(new Error("A positive amount is required"), { status: 400 });
      }
      const crypto = require("crypto");
      const row = {
        id: newId("aio"),
        project_id: projectId,
        user_id: project.user_id,
        reference: "MITEXAI-" + crypto.randomBytes(6).toString("hex").toUpperCase(),
        amount: Math.round(value),
        currency,
        status: "pending",
        created_at: nowISO(),
      };
      return driver.insert("ai_orders", row);
    },

    async getOrderByReference(reference) {
      const rows = await driver.find("ai_orders", { reference }, { limit: 1 });
      return rows[0] || null;
    },

    async markOrderPaid(reference) {
      const order = await this.getOrderByReference(reference);
      if (!order) return false;
      if (order.status === "paid") return true;
      await driver.update("ai_orders", order.id, { status: "paid", paid_at: nowISO(), updated_at: nowISO() });
      // Payment confirms the sale, not the handover.
      const project = await this.get(order.project_id);
      if (project && project.status === "approved") {
        await driver.update("ai_projects", order.project_id, { status: "paid", updated_at: nowISO() });
      }
      return true;
    },

    // The single path to a customer download. Refuses unless an order for this
    // project is actually marked paid, so a caller bug cannot hand over unpaid
    // work.
    async release(projectId, { role = "customer", actorId = null } = {}) {
      const project = await this.get(projectId);
      if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
      if (project.status === "released") return project;
      if (!canTransition(project.status, "released")) {
        throw Object.assign(new Error(`Cannot move project from "${project.status}" to "released"`), {
          status: 409,
        });
      }
      if (ADMIN_ONLY.has("released") && role !== "admin") {
        throw Object.assign(new Error("Only staff can perform this step"), { status: 403 });
      }
      if (role !== "admin" && actorId != null && String(project.user_id) !== String(actorId)) {
        throw Object.assign(new Error("Not your project"), { status: 403 });
      }
      const orders = await driver.find("ai_orders", { project_id: projectId }, {});
      const paid = orders.some((o) => o.status === "paid");
      if (!paid) {
        throw Object.assign(new Error("Payment has not been confirmed for this project"), {
          status: 409,
        });
      }
      await driver.update("ai_projects", projectId, { status: "released", updated_at: nowISO() });
      for (const o of orders) {
        if (o.status === "paid") {
          await driver.update("ai_orders", o.id, { released_at: nowISO(), updated_at: nowISO() });
        }
      }
      return this.get(projectId);
    },

    // ---- deploys ----------------------------------------------------------

    async createDeploy(projectId, { provider, targetUrl = null } = {}) {
      const project = await this.get(projectId);
      if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
      if (project.status !== "released") {
        throw Object.assign(new Error("Only a delivered project can be published"), { status: 409 });
      }
      if (!String(provider || "").trim()) {
        throw Object.assign(new Error("A deploy provider is required"), { status: 400 });
      }
      return driver.insert("ai_deploys", {
        id: newId("aid"),
        project_id: projectId,
        provider: String(provider).trim().slice(0, 40),
        target_url: targetUrl,
        status: "pending",
        live: 0,
        created_at: nowISO(),
      });
    },

    async setDeployStatus(deployId, status, extra = {}) {
      return driver.update("ai_deploys", deployId, {
        status,
        live: status === "live" ? 1 : 0,
        updated_at: nowISO(),
        ...extra,
      });
    },

    async listDeploys(projectId) {
      return driver.find("ai_deploys", { project_id: projectId }, {});
    },

    // Frees storage for abandoned drafts. Never touches anything a customer
    // has paid for.
    async pruneDrafts(olderThanDays = 30) {
      const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
      const rows = await driver.find(
        "ai_projects",
        { status: { $in: ["draft", "failed"] }, created_at: { $lt: cutoff } },
        {}
      );
      let n = 0;
      for (const r of rows) {
        if (await driver.remove("ai_projects", r.id)) n++;
      }
      return n;
    },
  };
}

function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

module.exports = { makeAiProjects, DDL_SQLITE, STATUSES, TRANSITIONS, ADMIN_ONLY, canTransition };
