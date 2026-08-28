const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");
const { validateDob, validateNin, validateNinFile, encNin, decNin } = require("../utils/verify");
const cardbox = require("../utils/cardbox");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicProfile(user) {
  if (!user) return null;
  const { password_hash, nin_bvn, nin_file, payment_enc, ...rest } = user;
  return rest;
}

// Decorate a fresh user row with derived flags for the account/worker dashboards.
function selfView(user) {
  if (!user) return null;
  const { password_hash, nin_bvn, nin_file, payment_enc, ...rest } = user;
  const readiness = cardbox.readiness(cardbox.parse(user));
  return {
    ...rest,
    id: user.id,
    payment_saved: readiness === "one-tap",
    payment_pending: readiness === "pending",
    verified_id: Boolean(nin_bvn),
    nin_bvn: decNin(nin_bvn),
    nin_file: decNin(nin_file),
  };
}

// GET /api/users/me - own full profile
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await req.store.users.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(selfView(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
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
    if (req.body.country !== undefined) {
      patch.country = String(req.body.country).trim().toUpperCase().slice(0, 2) || "NG";
    }
    if (req.body.locale !== undefined) {
      patch.locale = String(req.body.locale).trim().toLowerCase().slice(0, 5) || "en";
    }
    if (req.body.dob !== undefined) {
      const dob = String(req.body.dob).trim();
      const dobCheck = validateDob(dob);
      if (!dobCheck.ok) {
        return res.status(400).json({ error: dobCheck.error });
      }
      patch.dob = dob;
    }
    if (req.body.ninBvn !== undefined) {
      const ninCheck = validateNin(req.body.ninBvn);
      if (!ninCheck.ok) {
        return res.status(400).json({ error: ninCheck.error });
      }
      patch.nin_bvn = encNin(req.body.ninBvn);
    }
    if (req.body.ninFile !== undefined) {
      const fileCheck = validateNinFile(req.body.ninFile);
      if (!fileCheck.ok) {
        return res.status(400).json({ error: fileCheck.error });
      }
      patch.nin_file = encNin(fileCheck.value);
    }
    if (req.body.saveCard !== undefined) {
      if (req.body.saveCard) {
        const paystack = require("../utils/paystack");
        if (paystack.isConfigured()) {
          const token = String(req.body.cardToken || "").trim();
          if (token) {
            const tok = await paystack.tokenizeCard({ email: req.user.email, token });
            await cardbox.storeAuthorization(store, req.user.id, {
              authorization_code: tok.authorization_code,
              customer_code: tok.customer_code,
            });
          } else {
            await cardbox.storePending(store, req.user.id);
          }
        } else {
          await cardbox.storeDemo(store, req.user.id);
        }
      } else {
        await cardbox.clear(store, req.user.id);
      }
    }

    const updated = await store.users.update(req.user.id, patch);
    res.json({ message: "Profile updated", user: selfView(updated) });
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

// DELETE /api/users/me - self-service account deletion (soft-delete)
router.delete("/me", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const currentPassword = String(req.body.password || "");
    if (!currentPassword) {
      return res.status(400).json({ error: "Password required to delete your account" });
    }
    const user = await store.users.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Account not found" });
    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(403).json({ error: "Incorrect password" });

    await store.users.update(req.user.id, { active: 0 });
    res.clearCookie("token", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    res.json({ message: "Account deactivated" });
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
