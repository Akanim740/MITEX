const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Chat is the cheapest AI feature to spam, so it gets the tightest window.
// The service layer bounds each call; this bounds how many happen at all.
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Slow down." },
});

// POST /api/chat
// Body: { messages: [{role: "user"|"assistant", content: string}] }
// History lives on the client; nothing here is persisted.
router.post("/", requireAuth, chatLimiter, async (req, res) => {
  try {
    const { messages } = req.body || {};
    const { chat } = require("../services/ai-chat");
    const result = await chat({ messages });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("[chat] error:", e);
    // 400s come from sanitisation and are safe to surface verbatim; they are
    // our own wording, not provider output.
    res.status(status).json({ error: e.message || "Chat failed" });
  }
});

module.exports = router;
