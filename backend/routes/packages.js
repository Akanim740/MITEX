const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");

// Package keys become HTML/data attributes and URL segments: constrain to a
// safe slug so a crafted key can never smuggle markup into the dashboard or
// checkout pages.
function slugifyKey(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// GET /api/packages - public pricing page
router.get("/", async (req, res) => {
  try {
    const rows = await req.store.packages.list();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/packages/:key - single package (used by checkout)
router.get("/:key", async (req, res) => {
  try {
    const pkg = await req.store.packages.get(req.params.key);
    if (!pkg) return res.status(404).json({ error: "Package not found" });
    res.json(pkg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/packages - admin create package
router.post("/", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const v = req.body || {};
    const key = slugifyKey(v.key);
    if (!key) return res.status(400).json({ error: "Package key is required" });
    if (!v.name) return res.status(400).json({ error: "Package name is required" });
    if (await req.store.packages.get(key)) return res.status(409).json({ error: "Package key already exists" });
    const row = await req.store.packages.create({ ...v, key });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/packages/:key - admin update package
router.put("/:key", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const row = await req.store.packages.update(req.params.key, req.body || {});
    if (!row) return res.status(404).json({ error: "Package not found" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/packages/:key - admin delete package
router.delete("/:key", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ok = await req.store.packages.remove(req.params.key);
    if (!ok) return res.status(404).json({ error: "Package not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;