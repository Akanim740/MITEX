const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");
const { listMailbox, smtpConfigured } = require("../utils/mailer");

// GET /api/admin/mailbox - the admin's email outbox (in-memory).
// Lets the owner review and forward emails while SMTP is not configured.
router.get("/mailbox", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    res.json({ configured: smtpConfigured(), count: listMailbox().length, mails: listMailbox() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;