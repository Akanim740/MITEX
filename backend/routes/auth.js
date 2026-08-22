const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const { signAccessToken, requireAuth, requireRole, resolveRefreshSession, ACCESS_TTL } = require("../middleware/auth");
const { randomToken, sha256 } = require("../utils/tokens");
const { sendMail, verificationEmail, resetEmail, smtpConfigured } = require("../utils/mailer");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFRESH_COOKIE = "mitex_refresh";
const VERIFY_TOKEN_HOURS = 24;
const RESET_TOKEN_HOURS = 1;
const REFRESH_DAYS = Number(process.env.REFRESH_TTL_DAYS || 7);

function setRefreshCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
    path: "/api/auth",
  });
}

async function issueSession(store, res, user) {
  const rawRefresh = randomToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await store.sessions.create({ userId: user.id, tokenHash: sha256(rawRefresh), expiresAt });
  setRefreshCookie(res, rawRefresh);
  return { accessToken: signAccessToken(user), refreshToken: rawRefresh };
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const store = req.store;
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: "Name must be 2-80 characters" });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: "Password must be at least 8 characters and include letters and numbers" });
    }

    const existing = await store.users.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await store.users.create({ name, email, passwordHash, role: "customer", emailVerified: 0 });

    const rawVerify = randomToken(32);
    await store.tokens.deleteByUser(user.id, "verify");
    await store.tokens.create({
      userId: user.id,
      tokenHash: sha256(rawVerify),
      type: "verify",
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_HOURS * 3600 * 1000).toISOString(),
    });

    const mail = verificationEmail(user, rawVerify);
    const result = await sendMail({ to: user.email, subject: mail.subject, text: mail.text });

    res.status(201).json({
      message: "Account created. Check your email to verify your address.",
      ...(result.dev ? { devToken: rawVerify, devVerifyUrl: mail.url } : {}),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, email_verified: 0 },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const store = req.store;
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await store.users.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { accessToken } = await issueSession(store, res, user);
    res.json({
      message: "Logged in",
      accessToken,
      expiresIn: ACCESS_TTL,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, email_verified: user.email_verified },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/refresh - rotate session, new access token
router.post("/refresh", async (req, res) => {
  try {
    const store = req.store;
    const resolved = await resolveRefreshSession(req);
    if (!resolved) {
      return res.status(401).json({ error: "No valid session" });
    }

    await store.sessions.revoke(resolved.session.id);
    const { accessToken } = await issueSession(store, res, resolved.user);

    res.json({
      message: "Session refreshed",
      accessToken,
      expiresIn: ACCESS_TTL,
      user: {
        id: resolved.user.id,
        name: resolved.user.name,
        email: resolved.user.email,
        role: resolved.user.role,
        email_verified: resolved.user.email_verified,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/logout - revoke current session
router.post("/logout", async (req, res) => {
  try {
    const store = req.store;
    const resolved = await resolveRefreshSession(req);
    if (resolved) {
      await store.sessions.revoke(resolved.session.id);
    }
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  res.json(req.user);
});

// GET /api/auth/verify-email?token=...
router.get("/verify-email", async (req, res) => {
  try {
    const store = req.store;
    const raw = String(req.query.token || "");
    if (!raw) return res.status(400).json({ error: "Verification token is required" });

    const row = await store.tokens.findValid(sha256(raw), "verify");
    if (!row) {
      return res.status(400).json({ error: "Invalid or expired verification link" });
    }

    await store.tokens.markUsed(row.id);
    await store.users.update(row.user_id, { email_verified: true });
    res.json({ message: "Email verified successfully. You can now log in." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/resend-verification (requires login)
router.post("/resend-verification", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    if (req.user.email_verified) {
      return res.json({ message: "Email is already verified" });
    }

    const rawVerify = randomToken(32);
    await store.tokens.deleteByUser(req.user.id, "verify");
    await store.tokens.create({
      userId: req.user.id,
      tokenHash: sha256(rawVerify),
      type: "verify",
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_HOURS * 3600 * 1000).toISOString(),
    });

    const mail = verificationEmail(req.user, rawVerify);
    const result = await sendMail({ to: req.user.email, subject: mail.subject, text: mail.text });

    res.json({
      message: "Verification email sent",
      ...(result.dev ? { devToken: rawVerify, devVerifyUrl: mail.url } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const store = req.store;
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    const user = await store.users.findByEmail(email);

    if (user) {
      const rawReset = randomToken(32);
      await store.tokens.deleteByUser(user.id, "reset");
      await store.tokens.create({
        userId: user.id,
        tokenHash: sha256(rawReset),
        type: "reset",
        expiresAt: new Date(Date.now() + RESET_TOKEN_HOURS * 3600 * 1000).toISOString(),
      });

      const mail = resetEmail(user, rawReset);
      const result = await sendMail({ to: user.email, subject: mail.subject, text: mail.text });

      return res.json({
        message: "If that email exists, a reset link has been sent.",
        ...(result.dev ? { devToken: rawReset, devResetUrl: mail.url } : {}),
      });
    }

    res.json({ message: "If that email exists, a reset link has been sent." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    const store = req.store;
    const raw = String(req.body.token || "");
    const newPassword = String(req.body.newPassword || "");

    if (!raw) return res.status(400).json({ error: "Reset token is required" });
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "Password must be at least 8 characters and include letters and numbers" });
    }

    const row = await store.tokens.findValid(sha256(raw), "reset");
    if (!row) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await store.tokens.markUsed(row.id);
    await store.users.updatePassword(row.user_id, passwordHash);
    await store.sessions.revokeAllForUser(row.user_id);

    res.json({ message: "Password reset successful. All previous sessions were logged out." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/dashboard - admin overview stats
router.get("/dashboard", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const store = req.store;
    const [enquiries, listings, subscribers, orders] = await Promise.all([
      store.enquiries.stats(),
      store.listings.stats(),
      store.subscribers.countActive(),
      store.orders.stats(),
    ]);
    res.json({ enquiries, listings, subscribers, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// WebAuthn / Passkeys - fingerprint & face login
// ---------------------------------------------------------------------------
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isoBase64URL } = require("@simplewebauthn/server/helpers");

const RP_NAME = "MITEX";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challenges = new Map();

function rpID() {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  return new URL(process.env.APP_URL || "http://localhost:3000").hostname;
}

function expectedOrigin() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function saveChallenge(key, challenge) {
  challenges.set(key, { challenge, expires: Date.now() + CHALLENGE_TTL_MS });
  for (const [k, v] of challenges) {
    if (v.expires < Date.now()) challenges.delete(k);
  }
}

function takeChallenge(key) {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}

// POST /api/auth/webauthn/register/options - begin passkey enrollment (logged-in users)
router.post("/webauthn/register/options", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const user = req.user;
    const existing = await store.credentials.listForUser(user.id);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpID(),
      userName: user.email,
      userDisplayName: user.name || user.email,
      userID: Uint8Array.from(isoBase64URL.toBuffer(isoBase64URL.fromUTF8String(String(user.id)))),
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.credential_id })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    saveChallenge(`reg:${user.id}`, options.challenge);
    res.json(options);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start biometric registration" });
  }
});

// POST /api/auth/webauthn/register/verify - finish passkey enrollment
router.post("/webauthn/register/verify", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const user = req.user;
    const expectedChallenge = takeChallenge(`reg:${user.id}`);
    if (!expectedChallenge) {
      return res.status(400).json({ error: "Registration session expired. Please try again." });
    }

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpID(),
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Biometric registration could not be verified" });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    const dup = await store.credentials.findByCredentialId(credential.id);
    if (dup && String(dup.user_id) !== String(user.id)) {
      return res.status(409).json({ error: "This device is already registered to another account" });
    }
    if (dup) {
      await store.credentials.remove(dup.id);
    }

    await store.credentials.create({
      userId: user.id,
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    });

    res.json({ message: "Biometric sign-in enabled on this device", verified: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Biometric registration failed" });
  }
});

// POST /api/auth/webauthn/login/options - begin biometric login
router.post("/webauthn/login/options", async (req, res) => {
  try {
    const store = req.store;
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter your email first to use biometric login" });
    }

    const user = await store.users.findByEmail(email);
    if (!user) {
      return res.status(404).json({ error: "No biometric sign-in found for this email. Sign in with your password first, then enable it in My Account." });
    }
    const creds = await store.credentials.listForUser(user.id);
    if (!creds.length) {
      return res.status(404).json({ error: "No biometric sign-in found for this email. Sign in with your password first, then enable it in My Account." });
    }

    const options = await generateAuthenticationOptions({
      rpID: rpID(),
      allowCredentials: creds.map((c) => ({ id: c.credential_id })),
      userVerification: "preferred",
    });

    saveChallenge(`auth:${email}`, options.challenge);
    res.json(options);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start biometric login" });
  }
});

// POST /api/auth/webauthn/login/verify - finish biometric login
router.post("/webauthn/login/verify", async (req, res) => {
  try {
    const store = req.store;
    const email = String(req.body.email || "").trim().toLowerCase();
    const response = req.body.response;
    if (!email || !response) {
      return res.status(400).json({ error: "Missing email or credential response" });
    }

    const expectedChallenge = takeChallenge(`auth:${email}`);
    if (!expectedChallenge) {
      return res.status(400).json({ error: "Login session expired. Please try again." });
    }

    const cred = await store.credentials.findByCredentialId(response.id);
    if (!cred) {
      return res.status(400).json({ error: "Unknown device credential" });
    }

    const user = await store.users.findById(cred.user_id);
    if (!user || user.email !== email) {
      return res.status(401).json({ error: "This device is not linked to that account" });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpID(),
      credential: {
        id: cred.credential_id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: Number(cred.counter) || 0,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return res.status(401).json({ error: "Biometric verification failed" });
    }

    await store.credentials.updateCounter(cred.id, verification.authenticationInfo.newCounter);

    const { accessToken } = await issueSession(store, res, user);
    res.json({
      message: `Welcome back, ${user.name.split(" ")[0]}!`,
      accessToken,
      expiresIn: ACCESS_TTL,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, email_verified: user.email_verified },
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Biometric login failed" });
  }
});

// GET /api/auth/webauthn/credentials - list my passkey devices (logged-in)
router.get("/webauthn/credentials", requireAuth, async (req, res) => {
  try {
    const rows = await req.store.credentials.listForUser(req.user.id);
    res.json(
      rows.map((r) => ({
        id: r.id,
        device_type: r.device_type,
        backed_up: !!Number(r.backed_up),
        created_at: r.created_at,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/auth/webauthn/credentials/:id - remove a passkey device (logged-in)
router.delete("/webauthn/credentials/:id", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const rows = await store.credentials.listForUser(req.user.id);
    const target = rows.find((r) => String(r.id) === String(req.params.id));
    if (!target) return res.status(404).json({ error: "Device not found" });

    await store.credentials.remove(target.id);
    res.json({ message: "Biometric device removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
