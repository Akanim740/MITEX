const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9][0-9\s\-()]{6,20}$/;

function validateEnquiry(body) {
  const errors = [];
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const intent = String(body.intent || "").trim().toLowerCase();
  const level = body.level === undefined || body.level === null || body.level === "" ? null : Number(body.level);
  const message = String(body.message || "").trim();

  if (name.length < 2 || name.length > 100) errors.push("Name must be 2-100 characters");
  if (!EMAIL_RE.test(email)) errors.push("A valid email is required");
  if (phone && !PHONE_RE.test(phone)) errors.push("Invalid phone number");
  if (intent && !["buy", "sell"].includes(intent)) errors.push("Intent must be 'buy' or 'sell'");
  if (level !== null && (!Number.isInteger(level) || level < 1 || level > 7)) errors.push("Level must be between 1 and 7");
  if (message.length < 5 || message.length > 2000) errors.push("Message must be 5-2000 characters");

  return { errors, values: { name, email, phone: phone || null, intent: intent || null, level, message } };
}

// POST /api/enquiries - public: website enquiry form
router.post("/", async (req, res) => {
  try {
    const { errors, values } = validateEnquiry(req.body);
    if (errors.length) {
      return res.status(400).json({ error: errors.join("; ") });
    }
    const row = await req.store.enquiries.create(values);
    res.status(201).json({
      message: "Enquiry received. The MITEX team will contact you shortly.",
      id: row.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/enquiries - staff list (newest first), optional ?status=new
router.get("/", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const rows = await req.store.enquiries.list(req.query.status);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/enquiries/:id
router.get("/:id", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const row = await req.store.enquiries.get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/enquiries/:id/status
router.patch("/:id/status", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const { status } = req.body;
    if (!["new", "contacted", "closed"].includes(status)) {
      return res.status(400).json({ error: "Status must be new, contacted or closed" });
    }
    const ok = await req.store.enquiries.setStatus(req.params.id, status);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ message: `Enquiry marked as ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/enquiries/:id
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ok = await req.store.enquiries.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
