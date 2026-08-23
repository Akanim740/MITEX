const express = require("express");
const router = express.Router();

const { requireAuth, requireRole, optionalAuth } = require("../middleware/auth");

function validateListing(body, partial = false) {
  const errors = [];
  const out = {};

  if (!partial || body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (title.length < 3 || title.length > 120) errors.push("Title must be 3-120 characters");
    out.title = title;
  }
  if (!partial || body.description !== undefined) {
    const description = String(body.description || "").trim();
    if (description.length < 10 || description.length > 3000) errors.push("Description must be 10-3000 characters");
    out.description = description;
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) errors.push("Price must be a positive number");
    out.price = price;
  }
  if (body.level !== undefined) {
    const level = body.level === null || body.level === "" ? null : Number(body.level);
    if (level !== null && (!Number.isInteger(level) || level < 1 || level > 7)) errors.push("Level must be between 1 and 7");
    out.level = level;
  }
  if (body.tech_stack !== undefined) {
    out.tech_stack = String(body.tech_stack || "").trim().slice(0, 300) || null;
  }
  if (body.status !== undefined) {
    if (!["available", "sold"].includes(body.status)) errors.push("Status must be 'available' or 'sold'");
    out.status = body.status;
  }
  if (body.thumbnail !== undefined) {
    out.thumbnail = String(body.thumbnail || "").trim().slice(0, 500) || null;
  }
  if (body.deliveryUrl !== undefined) {
    out.delivery_url = String(body.deliveryUrl || "").trim().slice(0, 800) || null;
  }
  if (body.employeeId !== undefined) {
    out.employee_id = body.employeeId === null || body.employeeId === "" ? null : String(body.employeeId);
  }

  return { errors, values: out };
}

function isAdminLevel(req) {
  return Boolean(req.user && ["admin", "editor"].includes(req.user.role));
}

function isStaff(req) {
  return Boolean(req.user && req.user.role === "staff");
}

function canSeeDelivery(row, req) {
  if (!req.user || !row) return false;
  if (isAdminLevel(req)) return true;
  if (isStaff(req)) return row.employee_id !== undefined && String(row.employee_id) === String(req.user.id);
  return false;
}

function stripDelivery(row, req) {
  if (!row) return row;
  if (canSeeDelivery(row, req)) return row;
  const { delivery_url, ...rest } = row;
  return rest;
}

async function attachEmployee(store, row, req) {
  // Public "handled by" info so buyers know who to talk to.
  if (!row || !row.employee_id) return row;
  try {
    const u = await store.users.findById(row.employee_id);
    if (u && u.role === "staff" && Number(u.active)) {
      return {
        ...row,
        employee: { id: u.id, name: u.name, phone: u.phone || null, title: u.bio || null },
      };
    }
  } catch {}
  return row;
}

// GET /api/listings/mine - staff: listings assigned to me
router.get("/mine", requireAuth, requireRole("staff"), async (req, res) => {
  try {
    const rows = await req.store.listings.listForEmployee(String(req.user.id));
    res.json(rows.map((row) => stripDelivery(row, req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/listings - public: browse premium websites for sale
router.get("/", optionalAuth, async (req, res) => {
  try {
    const { level, includeSold } = req.query;
    const rows = await req.store.listings.list({
      includeSold: includeSold === "true",
      level,
    });
    const withStaff = await Promise.all(rows.map((row) => attachEmployee(req.store, row, req)));
    res.json(withStaff.map((row) => stripDelivery(row, req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/listings/:id - public single listing
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const row = await req.store.listings.get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const withEmployee = await attachEmployee(req.store, row, req);
    res.json(stripDelivery(withEmployee, req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/listings - staff: add a website for sale
router.post("/", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    const { errors, values } = validateListing(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const row = await req.store.listings.create(values);
    res.status(201).json({ message: "Listing created", listing: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/listings/:id - admin/editor: any listing; staff: only their assigned listing
router.put("/:id", requireAuth, requireRole("admin", "editor", "staff"), async (req, res) => {
  try {
    const store = req.store;
    const existing = await store.listings.get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    if (isStaff(req)) {
      if (existing.employee_id === undefined || String(existing.employee_id) !== String(req.user.id)) {
        return res.status(403).json({ error: "This listing is not assigned to you" });
      }
    }

    const { errors, values } = validateListing(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    // Only admins can (re)assign employees.
    if (isStaff(req)) delete values.employee_id;
    else if ("employee_id" in values && values.employee_id !== null) {
      const emp = await store.users.findById(values.employee_id);
      if (!emp || emp.role !== "staff") {
        return res.status(400).json({ error: "Selected employee not found" });
      }
    }

    const row = await store.listings.update(req.params.id, values);
    res.json({ message: "Listing updated", listing: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/listings/:id - admin removes
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ok = await req.store.listings.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
