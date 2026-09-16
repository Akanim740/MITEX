const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");

// GET /api/packages - public pricing page
router.get("/", async (req, res) => {
  try {
    const rows = await req.store.packages.list();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/packages/:key - single package (used by checkout)
router.get("/:key", async (req, res) => {
  try {
    const pkg = await req.store.packages.get(req.params.key);
    if (!pkg) return res.status(404).json({ error: "Package not found" });
    res.json(pkg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/packages - admin create package
router.post("/", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const v = req.body || {};
    const key = String(v.key || "").trim().replace(/\s+/g, "-").toLowerCase();
    if (!key) return res.status(400).json({ error: "Package key is required" });
    if (!v.name) return res.status(400).json({ error: "Package name is required" });
    if (await req.store.packages.get(key)) return res.status(409).json({ error: "Package key already exists" });
    const row = await req.store.packages.create({ ...v, key });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/packages/:key - admin update package
router.put("/:key", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const row = await req.store.packages.update(req.params.key, req.body || {});
    if (!row) return res.status(404).json({ error: "Package not found" });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/packages/:key - admin delete package
router.delete("/:key", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ok = await req.store.packages.remove(req.params.key);
    if (!ok) return res.status(404).json({ error: "Package not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;