const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");

function validateListing(body, partial = false) {
  const errors = [];
  const out = {};

  if (!partial || body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (title.length < 3 || title.length > 120) errors.push("Title must be 3-120 characters");
    out.title = title;
  }
  if (!partial || body.description !== undefined) {
    const description = String(body.description || "").trim();
    if (description.length < 10 || description.length > 3000) errors.push("Description must be 10-3000 characters");
    out.description = description;
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) errors.push("Price must be a positive number");
    out.price = price;
  }
  if (body.level !== undefined) {
    const level = body.level === null || body.level === "" ? null : Number(body.level);
    if (level !== null && (!Number.isInteger(level) || level < 1 || level > 7)) errors.push("Level must be between 1 and 7");
    out.level = level;
  }
  if (body.tech_stack !== undefined) {
    out.tech_stack = String(body.tech_stack || "").trim().slice(0, 300) || null;
  }
  if (body.status !== undefined) {
    if (!["available", "sold"].includes(body.status)) errors.push("Status must be 'available' or 'sold'");
    out.status = body.status;
  }
  if (body.thumbnail !== undefined) {
    out.thumbnail = String(body.thumbnail || "").trim().slice(0, 500) || null;
  }

  return { errors, values: out };
}

// GET /api/listings - public: browse premium websites for sale
router.get("/", async (req, res) => {
  try {
    const { level, includeSold } = req.query;
    const rows = await req.store.listings.list({
      includeSold: includeSold === "true",
      level,
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/listings/:id - public single listing
router.get("/:id", async (req, res) => {
  try {
    const row = await req.store.listings.get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/listings - staff: add a website for sale
router.post("/", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const { errors, values } = validateListing(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const row = await req.store.listings.create(values);
    res.status(201).json({ message: "Listing created", listing: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/listings/:id - staff: update a listing
router.put("/:id", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const existing = await req.store.listings.get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const { errors, values } = validateListing(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const row = await req.store.listings.update(req.params.id, values);
    res.json({ message: "Listing updated", listing: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/listings/:id - admin removes
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ok = await req.store.listings.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
