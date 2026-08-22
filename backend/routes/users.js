const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicProfile(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

// GET /api/users/me - own full profile
router.get("/me", requireAuth, async (req, res) => {
  res.json(publicProfile(req.user));
});

// PUT /api/users/me - edit own profile
router.put("/me", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const patch = {};

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < 2 || name.length > 80) {
        return res.status(400).json({ error: "Name must be 2-80 characters" });
      }
      patch.name = name;
    }
    if (req.body.phone !== undefined) {
      const phone = String(req.body.phone).trim();
      if (phone && !/^[+0-9][0-9\s\-()]{6,20}$/.test(phone)) {
        return res.status(400).json({ error: "Invalid phone number" });
      }
      patch.phone = phone || null;
    }
    if (req.body.bio !== undefined) {
      patch.bio = String(req.body.bio).trim().slice(0, 1000) || null;
    }
    if (req.body.avatar_url !== undefined) {
      patch.avatar_url = String(req.body.avatar_url).trim().slice(0, 500) || null;
    }

    const updated = await store.users.update(req.user.id, patch);
    res.json({ message: "Profile updated", user: publicProfile(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/users/me/password - change own password
router.post("/me/password", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "New password must be at least 8 characters and include letters and numbers" });
    }

    const full = await store.users.findById(req.user.id);
    if (!(await bcrypt.compare(currentPassword, full.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await store.users.updatePassword(req.user.id, passwordHash);
    await store.sessions.revokeAllForUser(req.user.id);

    res.json({ message: "Password changed. Please log in again on your other devices." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users - admin list all users
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const rows = await req.store.users.list();
    res.json(rows.map(publicProfile));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/users/:id/role - admin changes a user role
router.patch("/:id/role", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const store = req.store;
    const { role } = req.body;
    if (!["admin", "editor", "customer"].includes(role)) {
      return res.status(400).json({ error: "Role must be admin, editor or customer" });
    }
    if (String(req.user.id) === String(req.params.id) && role !== "admin") {
      return res.status(400).json({ error: "You cannot demote your own account" });
    }
    const updated = await store.users.update(req.params.id, { role });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ message: `Role updated to ${role}`, user: publicProfile(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/users/:id - admin removes a user
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (String(req.user.id) === String(req.params.id)) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }
    const ok = await req.store.users.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
