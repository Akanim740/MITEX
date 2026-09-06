const express = require("express");
const router = express.Router();

const { requireAuth, requireRole, optionalAuth } = require("../middleware/auth");
const { websiteScore, sellerTrust, valuate, assetTypeOf, protectedOf } = require("../utils/listing-metrics");

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
  if (body.demoUrl !== undefined) {
    out.demo_url = String(body.demoUrl || "").trim().slice(0, 800) || null;
  }
  if (body.assetType !== undefined) {
    const t = String(body.assetType || "website").trim().toLowerCase();
    if (!["website", "business"].includes(t)) errors.push("assetType must be 'website' or 'business'");
    out.asset_type = t;
  }
  if (body.protected !== undefined) {
    out.protected = body.protected !== "false" && body.protected !== false && body.protected !== 0 && body.protected !== "0";
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
  // Public consumers see whether the site is buyable, never the URL itself.
  return { ...rest, deliveryReady: Boolean(delivery_url) };
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

// One paid-orders pass → per-listing purchase counts for the Trust Score.
async function trustCounts(store) {
  const counts = new Map();
  try {
    const paid = await store.orders.listAll("paid");
    for (const o of paid) {
      const k = String(o.listing_id ?? o.listingId ?? "");
      if (!k) continue;
      const c = counts.get(k) || { paid: 0, delivered: 0 };
      c.paid += 1;
      counts.set(k, c);
    }
  } catch {}
  return counts;
}

// Attach Website Score, Trust Score, asset type, protection and demo link.
// All fields derive from existing columns, so pre-migration prod data still
// gets usable (default) values instead of errors.
function decorate(row, counts, withValuation = false) {
  if (!row) return row;
  const score = websiteScore(row);
  const stat = counts.get(String(row.id)) || { paid: 0, delivered: 0 };
  const done = Boolean(row.delivery_url) || String(row.status) === "sold";
  const trust = sellerTrust({ paid: stat.paid || 0, delivered: done ? Math.max(1, stat.paid || 1) : 0 });
  const out = {
    ...row,
    score: score.score,
    scoreLabel: score.label,
    scoreMax: score.max,
    trustScore: trust.score,
    trustLabel: trust.label,
    trustMax: trust.max,
    assetType: assetTypeOf(row),
    protected: protectedOf(row),
    demoUrl: row.demo_url || null,
    canDemo: Boolean(row.demo_url),
  };
  if (withValuation) out.valuation = valuate(row);
  return out;
}

// GET /api/listings/mine - staff: listings assigned to me
router.get("/mine", requireAuth, requireRole("staff"), async (req, res) => {
  try {
    const rows = await req.store.listings.listForEmployee(String(req.user.id));
    const counts = await trustCounts(req.store);
    res.json(rows.map((row) => stripDelivery(decorate(row, counts), req)));
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
    const counts = await trustCounts(req.store);
    const withStaff = await Promise.all(rows.map((row) => attachEmployee(req.store, row, req)));
    res.json(withStaff.map((row) => stripDelivery(decorate(row, counts, false), req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/listings/valuator - public: AI fair-price estimate.
// Declared before /:id so "valuator" is never parsed as a listing id.
router.post("/valuator", async (req, res) => {
  try {
    const { title, level, tech_stack, description, assetType } = req.body || {};
    const result = valuate({ title, level, tech_stack, description });
    result['assetType'] = String(assetType || "website").toLowerCase() === "business" ? "business" : "website";
    if (result.assetType === "business") {
      result.estimate = Math.round(result.estimate * 1.25 / 5000) * 5000;
      result.min = Math.round(result.min * 1.25 / 5000) * 5000;
      result.max = Math.round(result.max * 1.25 / 5000) * 5000;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/listings/stats - public social-proof numbers (no sensitive data).
// Declared before /:id so "stats" is not interpreted as a listing id.
router.get("/stats", async (req, res) => {
  try {
    const store = req.store;
    const all = await store.listings.list({ includeSold: true });
    const available = all.filter((r) => r.status === "available").length;
    const sold = all.filter((r) => r.status === "sold").length;
    const delivered = all.filter((r) => Boolean(r.delivery_url)).length;
    const paidOrders = await store.orders.listAll("paid");
    const recentSold = paidOrders
      .slice(0, 6)
      .map((o) => ({ title: o.title, price: o.amount, currency: o.currency, soldAt: o.created_at }));
    res.json({ available, sold, delivered, recentSold });
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
    const counts = await trustCounts(req.store);
    const withEmployee = await attachEmployee(req.store, row, req);
    res.json(stripDelivery(decorate(withEmployee, counts, true), req));
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

    // Worker saving delivery link for the first time → make it buyable
    if (isStaff(req) && values.delivery_url && !existing.delivery_url && existing.status === "sold") {
      values.status = "available";
    }

    const row = await store.listings.update(req.params.id, values);

    if (values.delivery_url && !existing.delivery_url) {
      // Paid buyer gets the delivery link.
      const orders = await store.orders.listAll("paid");
      const matchingOrder = orders.find((o) => String(o.listing_id) === String(req.params.id));
      if (matchingOrder) {
        const buyer = await store.users.findById(matchingOrder.user_id);
        if (buyer) {
          const { sendMail, deliveryEmail } = require("../utils/mailer");
          const mail = deliveryEmail(buyer, matchingOrder);
          setImmediate(() => sendMail({ to: buyer.email, subject: mail.subject, text: mail.text, html: mail.html }).catch(() => {}));
        }
      }

      // Waiting buyers (confirmed intent, not yet paid) get the go-ahead.
      // Guarded: never let the missing buy_intents table fail the delivery save.
      try {
        const waiting = await store.buyIntents.listWaitingByListing(String(req.params.id));
        for (const intent of waiting) {
          await store.buyIntents.setStatus(intent.id, "ready");
          const buyer = await store.users.findById(intent.user_id);
          if (!buyer) continue;
          const { notifyUser } = require("../utils/notify");
          const { sendMail, listingReadyEmail } = require("../utils/mailer");
          const mail = listingReadyEmail(buyer, existing || row);
          setImmediate(async () => {
            try {
              await notifyUser(store, {
                userId: buyer.id,
                type: "listing_ready",
                title: `"${(existing || row).title}" is ready to buy`,
                body: "The delivery link is now in place. You can complete your purchase.",
                link: "/marketplace.html",
              });
              await sendMail({ to: buyer.email, subject: mail.subject, text: mail.text, html: mail.html });
            } catch (e) {
              console.error("listing-ready notification failed:", e.message);
            }
          });
        }
      } catch (e) {
        console.error("waiting-buyer fanout skipped (buy_intents unavailable):", e.message);
      }
    }

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
