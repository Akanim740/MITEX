const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");
const { randomToken } = require("../utils/tokens");
const { sendMail, testEmail, hireEmail } = require("../utils/mailer");

// Staff accounts are capped at 21 - shared rule with routes/auth.js
const MAX_STAFF = Number(process.env.MAX_STAFF || 21);

// Public form endpoints get their own gentle limit
const publicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.APPLY_LIMIT || 15),
  message: { error: "Too many submissions, please try again later" },
});

function safeApp(app) {
  if (!app) return app;
  const { test_token, hire_token, ...rest } = app;
  return rest;
}

function publicView(app) {
  return {
    name: app.name,
    email: app.email,
    status: app.status,
    test_instructions: app.status === "test_sent" || app.status === "submitted" ? app.test_instructions : null,
    submit_url: app.submit_url || null,
    submitted_at: app.submitted_at || null,
    created_at: app.created_at,
  };
}

// POST /api/applications - anyone can apply to join the team
router.post("/", publicLimiter, async (req, res) => {
  try {
    const store = req.store;
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim() || null;
    const portfolio = String(req.body.portfolio || "").trim() || null;
    const message = String(req.body.message || "").trim();

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: "Name must be 2-80 characters" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    if (message.length < 20 || message.length > 2000) {
      return res.status(400).json({ error: "Tell us a bit more about yourself (20-2000 characters)" });
    }
    if (portfolio && !/^https?:\/\//i.test(portfolio)) {
      return res.status(400).json({ error: "Portfolio link must start with http:// or https://" });
    }

    const existing = await store.applications.findByEmail(email);
    if (existing && ["new", "test_sent", "submitted", "passed"].includes(existing.status)) {
      return res.status(409).json({ error: "You already have an active application with this email." });
    }

    const app = await store.applications.create({ name, email, phone, portfolio, message });
    res.status(201).json({ message: "Application received. We review every application and will contact you by email.", application: { id: app.id, status: app.status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/applications/status/:token - applicant checks their own progress
router.get("/status/:token", async (req, res) => {
  try {
    const app = await req.store.applications.getByTestToken(String(req.params.token || ""));
    if (!app) return res.status(404).json({ error: "Application not found. Check your link." });
    res.json(publicView(app));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/applications/submit-test - applicant submits their test website
router.post("/submit-test", publicLimiter, async (req, res) => {
  try {
    const store = req.store;
    const token = String(req.body.token || "");
    const url = String(req.body.url || "").trim();
    const notes = String(req.body.notes || "").trim();

    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "Enter the full link to your test website (starts with http:// or https://)" });
    }

    const app = await store.applications.getByTestToken(token);
    if (!app) return res.status(404).json({ error: "Application not found. Check your link." });
    if (!["test_sent", "submitted"].includes(app.status)) {
      return res.status(400).json({ error: "No test has been sent to you yet." });
    }

    await store.applications.setSubmission(app.id, { url, notes });
    res.json({ message: "Test submitted! Our team will review it and email you the result." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/applications - admin lists all applications
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const rows = await req.store.applications.list(req.query.status);
    res.json((rows || []).map(safeApp));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/applications/:id/send-test - admin sends the test website brief
router.post("/:id/send-test", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const store = req.store;
    const app = await store.applications.get(req.params.id);
    if (!app) return res.status(404).json({ error: "Application not found" });
    if (["passed", "rejected"].includes(app.status)) {
      return res.status(400).json({ error: `Cannot send a test for a ${app.status} application` });
    }

    // Default test brief if admin does not write one
    const instructions =
      String(req.body.instructions || "").trim() ||
      "Build a one-page website for an imaginary business of your choice. It must look professional on phones and laptops, load fast, and include a contact section. Host it anywhere free (Netlify, Vercel, GitHub Pages) and send us the live link.";

    const token = randomToken(24);
    await store.applications.setTest(app.id, { testToken: token, instructions });

    const mail = testEmail(app, token, instructions);
    let result;
    try {
      result = await sendMail({ to: app.email, subject: mail.subject, text: mail.text });
    } catch (mailErr) {
      console.error("send-test mail failed:", mailErr.message);
      return res.json({
        message: `Test saved, but the email failed to send (${mailErr.message}). Share this link manually.`,
        devLink: mail.url,
        devNote: "Email delivery problem - check your SMTP settings in Render",
      });
    }

    res.json({
      message: `Test sent to ${app.email}`,
      ...(result.dev ? { devLink: mail.url, devNote: "SMTP not configured - share this link manually" } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/applications/:id/reject - admin declines
router.post("/:id/reject", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ok = await req.store.applications.setStatus(req.params.id, "rejected");
    if (!ok) return res.status(404).json({ error: "Application not found" });
    res.json({ message: "Application rejected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/applications/:id/pass - admin hires: creates staff account + private onboard link
router.post("/:id/pass", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const store = req.store;
    const app = await store.applications.get(req.params.id);
    if (!app) return res.status(404).json({ error: "Application not found" });
    if (app.status !== "submitted") {
      return res.status(400).json({ error: "Only submitted tests can be marked as passed" });
    }

    const count = await store.users.countByRole("staff");
    if (count >= MAX_STAFF) {
      return res.status(403).json({ error: `Staff limit reached (${MAX_STAFF} employees max)` });
    }

    let user = await store.users.findByEmail(app.email);
    if (!user) {
      // Password is unusable until the applicant sets it via their private link
      user = await store.users.create({
        name: app.name,
        email: app.email,
        passwordHash: randomToken(32),
        role: "staff",
        emailVerified: 1,
        phone: app.phone,
        bio: "MITEX Team Member",
        active: 1,
      });
    } else if (user.role !== "staff") {
      await store.users.update(user.id, { role: "staff", active: 1 });
    }

    const hireToken = randomToken(32);
    await store.applications.markHired(app.id, { staffUserId: user.id, hireToken });

    const mail = hireEmail(app, hireToken);
    let result;
    try {
      result = await sendMail({ to: app.email, subject: mail.subject, text: mail.text });
    } catch (mailErr) {
      console.error("pass mail failed:", mailErr.message);
      return res.json({
        message: `${app.name} passed and their staff account is ready. Email failed to send (${mailErr.message}) - share this link manually.`,
        devLink: mail.url,
        devNote: "Email delivery problem - check your SMTP settings in Render",
      });
    }

    res.json({
      message: `${app.name} passed. Onboarding link emailed.`,
      ...(result.dev ? { devLink: mail.url, devNote: "SMTP not configured - share this link manually" } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
