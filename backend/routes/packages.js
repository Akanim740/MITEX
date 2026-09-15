const express = require("express");
const router = express.Router();

const PACKAGES = require("../packages");

// GET /api/packages - public pricing page
router.get("/", (req, res) => {
  res.json(PACKAGES);
});

// GET /api/packages/:key - single package (used by checkout)
router.get("/:key", (req, res) => {
  const pkg = PACKAGES.find((p) => p.key === req.params.key);
  if (!pkg) return res.status(404).json({ error: "Package not found" });
  res.json(pkg);
});

module.exports = router;