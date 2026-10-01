const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");
const { listMailbox, mailboxStats, smtpConfigured, libraryLoaded } = require("../utils/mailer");

// GET /api/admin/mailbox - the admin's email outbox.
// Shows every email the site has generated, with its send status (sent /
// queued/retrying / failed / dropped-waiting-for-SMTP) and retry count.
router.get("/mailbox", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const [mails, stats] = await Promise.all([listMailbox(200), mailboxStats()]);
    res.json({ configured: smtpConfigured(), libraryLoaded: libraryLoaded(), count: mails.length, stats, mails });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/mailbox/health - SMTP + outbox delivery health for monitors.
router.get("/mailbox/health", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const s = await mailboxStats();
    res.json({
      ok: smtpConfigured() && s.failed === 0 && s.queued === 0,
      smtpConfigured: smtpConfigured(),
      queued: s.queued,
      sending: s.sending,
      failed: s.failed,
      totalSent: s.sent,
      lastSentAt: s.lastSentAt,
      lastError: s.lastError,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;