const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middleware/auth");
const { sendMail, salaryEmail } = require("../utils/mailer");

function validPeriod(p) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ""));
}

// POST /api/salaries - admin records a salary payment for an employee
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const store = req.store;
    const staffId = String(req.body.staffId || "");
    const amount = Number(req.body.amount);
    const bonus = Number(req.body.bonus || 0);
    const period = String(req.body.period || "").trim();
    const note = String(req.body.note || "").trim() || null;

    if (!validPeriod(period)) return res.status(400).json({ error: "Period must be in YYYY-MM format (e.g. 2026-08)" });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
      return res.status(400).json({ error: "Amount must be a positive number in Naira" });
    }
    if (!Number.isFinite(bonus) || bonus < 0) return res.status(400).json({ error: "Bonus must be 0 or more" });

    const staff = await store.users.findById(staffId);
    if (!staff) return res.status(404).json({ error: "Employee not found" });
    if (staff.role !== "staff") return res.status(400).json({ error: "Salaries are only for employees" });

    const payment = await store.salaries.create({ staffUserId: staff.id, amount, bonus, period, note });

    // Notify the employee - never block the record on mail problems
    let devLink = null;
    try {
      const mail = salaryEmail(staff, payment);
      const result = await sendMail({ to: staff.email, subject: mail.subject, text: mail.text });
      if (result.dev) devLink = null;
    } catch (mailErr) {
      console.error("salary email failed:", mailErr.message);
    }

    res.status(201).json({
      message: `Salary recorded for ${staff.name} (${period})`,
      payment,
      ...(devLink ? { devLink } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/salaries?staffId=&period= - admin lists payments
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { staffId, period } = req.query;
    const rows = staffId
      ? await req.store.salaries.listForStaff(staffId)
      : await req.store.salaries.listAll(period);
    const total = period ? await req.store.salaries.totalForPeriod(period) : null;
    res.json({ payments: rows, totalForPeriod: total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/salaries/mine - employee sees their own payment history
router.get("/mine", requireAuth, requireRole("admin", "editor", "staff"), async (req, res) => {
  try {
    res.json(await req.store.salaries.listForStaff(req.user.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/salaries/:id - admin removes a mistaken entry
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ok = await req.store.salaries.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: "Payment record not found" });
    res.json({ message: "Record removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
