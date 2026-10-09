const express = require("express");
const rateLimit = require("express-rate-limit");
const { normalizePage } = require("../services/concierge");

const router = express.Router();

// Concierge is the guest-visible assistant, so unlike /api/chat it does NOT
// require a login - a first-time visitor must be able to ask before they have
// an account. That also makes it the most exposed AI route, so the limiter is
// the tightest: the service bounds each call's cost, this bounds the volume.
const conciergeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Slow down." },
});

// POST /api/concierge
// Body: { messages: [{role: "user"|"assistant", content}], page?: string }
// Guests may chat; history stays on the client; nothing is persisted.
router.post("/", conciergeLimiter, async (req, res) => {
  try {
    const { messages, page } = req.body || {};
    const { concierge } = require("../services/concierge");
    const result = await concierge({ messages, page: normalizePage(page) });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("[concierge] error:", e);
    res.status(status).json({ error: e.message || "Tour guide failed" });
  }
});

module.exports = router;