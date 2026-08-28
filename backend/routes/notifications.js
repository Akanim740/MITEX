const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");

// GET /api/notifications - current user's notifications + unread count
router.get("/", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const items = await req.store.notifications.listForUser(req.user.id, limit);
    const unread = await req.store.notifications.unreadCount(req.user.id);
    res.json({ notifications: items, unread });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/notifications/read - mark one (with id) or all (no id) as read
router.post("/read", requireAuth, async (req, res) => {
  try {
    const id = req.body && req.body.id;
    await req.store.notifications.markRead(req.user.id, id ? String(id) : undefined);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;