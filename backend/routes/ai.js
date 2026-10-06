const express = require("express");
const rateLimit = require("express-rate-limit");

const router = express.Router();

// --- rate limits (tightened because AI builds consume tokens/cpu) ---------
const buildLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI builds. Try again later." },
});
const actionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many actions. Slow down." },
});

const authRequired = (req, res, next) => {
  if (!req.user || !req.user.id) return res.status(401).json({ error: "Sign in required" });
  next();
};

const staffRequired = (req, res, next) => {
  if (!req.user || !req.user.id) return res.status(401).json({ error: "Sign in required" });
  const role = String(req.user.role || "").toLowerCase();
  if (role !== "admin" && role !== "editor" && role !== "staff") {
    return res.status(403).json({ error: "Staff only" });
  }
  next();
};

function toActor(req) {
  const role = String(req.user && req.user.role || "customer").toLowerCase();
  return { role: role === "admin" || role === "editor" || role === "staff" ? "admin" : "customer", actorId: req.user && req.user.id || null };
}

// GET /api/ai/projects - my projects
router.get("/projects", authRequired, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    const rows = await s.aiProjects.listForUser(req.user.id, { limit: 50 });
    res.json({ ok: true, projects: rows });
  } catch (e) {
    console.error("[ai] projects list:", e);
    res.status(500).json({ error: "Failed to load projects" });
  }
});

// GET /api/ai/projects/all - staff
router.get("/projects/all", staffRequired, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    const { status } = req.query;
    const rows = await s.aiProjects.listAll({ status: status || null, limit: 200 });
    res.json({ ok: true, projects: rows });
  } catch (e) {
    console.error("[ai] projects all:", e);
    res.status(500).json({ error: "Failed to load projects" });
  }
});

// POST /api/ai/projects - create draft
router.post("/projects", authRequired, actionLimiter, async (req, res) => {
  try {
    const { title, brief, kind } = req.body || {};
    const { getStore } = require("../db");
    const s = await getStore();
    const p = await s.aiProjects.create({ userId: req.user.id, title, brief, kind: kind === "fix" ? "fix" : "build" });
    res.json({ ok: true, project: p });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ error: e.message || "Failed to create project" });
  }
});

// GET /api/ai/projects/:id
router.get("/projects/:id", authRequired, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    const p = await s.aiProjects.get(req.params.id);
    if (!p) return res.status(404).json({ error: "Project not found" });
    const { role, actorId } = toActor(req);
    if (role !== "admin" && String(p.user_id) !== String(actorId)) {
      return res.status(403).json({ error: "Not your project" });
    }
    const files = await s.aiProjects.listFiles(p.id);
    res.json({ ok: true, project: p, files });
  } catch (e) {
    res.status(500).json({ error: "Failed to load project" });
  }
});

// POST /api/ai/projects/:id/build - generate site
router.post("/projects/:id/build", authRequired, buildLimiter, async (req, res) => {
  let p;
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    p = await s.aiProjects.get(req.params.id);
    if (!p) return res.status(404).json({ error: "Project not found" });
    const { role, actorId } = toActor(req);
    if (role !== "admin" && String(p.user_id) !== String(actorId)) {
      return res.status(403).json({ error: "Not your project" });
    }
    const { brief, kind, extraNotes } = req.body || {};
    const useBrief = brief || p.brief;
    const { generateSite } = require("../services/ai-builder");
    const build = await generateSite({ brief: useBrief, kind: kind || p.kind || "build", extraNotes });
    await s.aiProjects.setStatus(p.id, build.ok ? "building" : "failed", { role, actorId });
    await s.aiProjects.saveBuild(p.id, build, { role, actorId });
    res.json({ ok: true, build });
  } catch (e) {
    console.error("[ai] build error:", e);
    if (p) {
      try {
        const { getStore } = require("../db");
        const s = await getStore();
        await s.aiProjects.setStatus(p.id, "failed", { role: "admin" });
        await s.db?.run?.(); // no-op
      } catch {}
    }
    const status = e.status || 500;
    res.status(status).json({ error: e.message || "Build failed" });
  }
});

// POST /api/ai/projects/:id/approve - staff approve
router.post("/projects/:id/approve", staffRequired, actionLimiter, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    await s.aiProjects.setStatus(req.params.id, "approved", { role: "admin" });
    res.json({ ok: true });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ error: e.message || "Cannot approve" });
  }
});

// POST /api/ai/projects/:id/reject - staff reject
router.post("/projects/:id/reject", staffRequired, actionLimiter, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    await s.aiProjects.setStatus(req.params.id, "rejected", { role: "admin" });
    res.json({ ok: true });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ error: e.message || "Cannot reject" });
  }
});

// POST /api/ai/projects/:id/retry - rebuild after reject/failed
router.post("/projects/:id/retry", authRequired, buildLimiter, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    const p = await s.aiProjects.get(req.params.id);
    if (!p) return res.status(404).json({ error: "Project not found" });
    const { role, actorId } = toActor(req);
    if (role !== "admin" && String(p.user_id) !== String(actorId)) {
      return res.status(403).json({ error: "Not your project" });
    }
    await s.aiProjects.setStatus(p.id, "building", { role, actorId });
    res.json({ ok: true });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ error: e.message || "Cannot retry" });
  }
});

// POST /api/ai/projects/:id/order - request payment
router.post("/projects/:id/order", authRequired, actionLimiter, async (req, res) => {
  try {
    const { amount, currency } = req.body || {};
    const { getStore } = require("../db");
    const s = await getStore();
    const p = await s.aiProjects.get(req.params.id);
    if (!p) return res.status(404).json({ error: "Project not found" });
    const { role, actorId } = toActor(req);
    if (role !== "admin" && String(p.user_id) !== String(actorId)) {
      return res.status(403).json({ error: "Not your project" });
    }
    const order = await s.aiProjects.createOrder(p.id, { amount: amount || p.price || 0, currency: currency || p.currency || "NGN" });
    res.json({ ok: true, order });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ error: e.message || "Cannot create order" });
  }
});

// POST /api/ai/orders/:reference/pay - staff confirm paid (for now)
router.post("/orders/:reference/pay", staffRequired, actionLimiter, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    await s.aiProjects.markOrderPaid(req.params.reference);
    res.json({ ok: true });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ error: e.message || "Cannot mark paid" });
  }
});

// POST /api/ai/projects/:id/release - staff release download
router.post("/projects/:id/release", staffRequired, actionLimiter, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    const rel = await s.aiProjects.release(req.params.id, { role: "admin" });
    res.json({ ok: true, project: rel });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ error: e.message || "Cannot release" });
  }
});

// GET /api/ai/projects/:id/download - download zip
router.get("/projects/:id/download", authRequired, async (req, res) => {
  try {
    const { getStore } = require("../db");
    const s = await getStore();
    const p = await s.aiProjects.get(req.params.id);
    if (!p) return res.status(404).json({ error: "Project not found" });
    const { role, actorId } = toActor(req);
    if (role !== "admin" && String(p.user_id) !== String(actorId)) {
      return res.status(403).json({ error: "Not your project" });
    }
    if (p.status !== "released") {
      return res.status(409).json({ error: "Project not released yet" });
    }
    const files = await s.aiProjects.listFiles(p.id);
    if (!files.length) return res.status(404).json({ error: "No files to download" });
    const archiver = require("archiver");
    const archive = archiver("zip", { zlib: { level: 9 } });
    res.setHeader("Content-Type", "application/zip");
    const safe = String(p.title || "site").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "site";
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.zip"`);
    archive.pipe(res);
    for (const f of files) {
      archive.append(String(f.content || ""), { name: f.path });
    }
    await archive.finalize();
  } catch (e) {
    console.error("[ai] download:", e);
    res.status(500).json({ error: "Failed to create download" });
  }
});

module.exports = router;
