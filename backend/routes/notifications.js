const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");

// GET /api/notifications - current user's notifications + unread count
router.get("/", requireAuth, async (req, res) => {
  try {
    if (req.store.features && !req.store.features.notifications) {
      return res.json({ notifications: [], unread: 0, unavailable: true });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    let items = [];
    let unread = 0;
    try {
      items = await req.store.notifications.listForUser(req.user.id, limit);
      unread = await req.store.notifications.unreadCount(req.user.id);
    } catch (err) {
      if (req.store._missingRelation && req.store._missingRelation(err)) {
        return res.json({ notifications: [], unread: 0, unavailable: true });
      }
      throw err;
    }
    res.json({ notifications: items, unread });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/notifications/read - mark one (with id) or all (no id) as read
router.post("/read", requireAuth, async (req, res) => {
  try {
    if (req.store.features && !req.store.features.notifications) {
      return res.json({ ok: true });
    }
    const id = req.body && req.body.id;
    try {
      await req.store.notifications.markRead(req.user.id, id ? String(id) : undefined);
    } catch (err) {
      if (req.store._missingRelation && req.store._missingRelation(err)) {
        return res.json({ ok: true });
      }
      throw err;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;