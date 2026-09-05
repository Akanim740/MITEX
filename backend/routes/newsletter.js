const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/newsletter - public subscribe
router.post("/", async (req, res) => {
  try {
    const store = req.store;
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    const existing = await store.subscribers.findByEmail(email);
    if (existing) {
      if (!existing.active) {
        await store.subscribers.activate(email);
        return res.json({ message: "Welcome back! You are subscribed again." });
      }
      return res.status(409).json({ error: "This email is already subscribed" });
    }

    await store.subscribers.create(email);
    res.status(201).json({ message: "Subscribed. You will hear from MITEX soon." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/newsletter/:email - unsubscribe (must be logged in; owners or admins)
router.delete("/:email", requireAuth, async (req, res) => {
  try {
    const target = String(req.params.email || "").trim().toLowerCase();
    const isOwner = String(req.user.email || "").trim().toLowerCase() === target;
    const isAdmin = ["admin", "editor"].includes(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "You can only unsubscribe your own email" });
    }
    const ok = await req.store.subscribers.deactivate(target);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Unsubscribed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/newsletter - admin list active subscribers
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    res.json(await req.store.subscribers.listActive());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
