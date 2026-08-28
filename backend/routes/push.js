const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const push = require("../utils/push");

// GET /api/push/public-key - VAPID public key used to subscribe a browser
router.get("/public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null, configured: push.isConfigured() });
});

// POST /api/push/subscribe - register this device for web push
router.post("/subscribe", requireAuth, async (req, res) => {
  try {
    if (!push.isConfigured()) {
      return res.status(503).json({ error: "Web push is not configured on this server yet." });
    }
    const { endpoint, p256dh, auth } = req.body || {};
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: "endpoint, p256dh and auth are required" });
    }
    await req.store.pushSubs.add({
      userId: req.user.id,
      endpoint: String(endpoint),
      p256dh: String(p256dh),
      auth: String(auth),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;