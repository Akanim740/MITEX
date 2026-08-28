const express = require("express");
const router = express.Router();

const { requireAuth, requireRole, requireAuthFlexible } = require("../middleware/auth");
const { randomToken } = require("../utils/tokens");
const { sendMail, receiptEmail } = require("../utils/mailer");
const paystack = require("../utils/paystack");
const cardbox = require("../utils/cardbox");

function newReference() {
  return `MITEX-${Date.now()}-${randomToken(4).toUpperCase()}`;
}

async function captureCard(store, buyer, authorization, customer) {
  if (!buyer || !authorization || !authorization.authorization_code || !cardbox.parse(buyer)) return;
  try {
    await cardbox.storeAuthorization(store, buyer.id, {
      authorization_code: authorization.authorization_code,
      customer_code: (customer && customer.customer_code) || null,
      last4: authorization.last4,
      card_type: authorization.card_type,
      reusable: authorization.reusable,
    });
  } catch (e) {
    // Never let card capture fail the payment that already succeeded.
    console.error("one-tap card capture failed:", e.message);
  }
}

async function settleOrder(store, order) {
  if (order.status === "paid") return;
  await store.orders.markPaid(order.reference, new Date().toISOString());
  if (order.listing_id) {
    const listing = await store.listings.get(order.listing_id);
    if (listing && listing.status === "available") {
      await store.listings.update(order.listing_id, { status: "sold" });
    }
  }
  // Save the buyer's card for one-tap only if they opted in at signup/settings.
  if (paystack.isConfigured()) {
    try {
      const buyer = await store.users.findById(order.user_id);
      const tx = await paystack.verifyTransaction(order.reference);
      await captureCard(store, buyer, tx.authorization, tx.customer);
    } catch (e) {
      console.error("one-tap card capture failed:", e.message);
    }
  }
  // Buyer receipt - a failed email must never fail the payment
  setImmediate(() => {
    sendMail({
      to: order.email,
      subject: `MITEX receipt - ${order.title} (${order.reference})`,
      text: receiptEmail(order).text,
    }).catch((e) => console.error("receipt email failed:", e.message));
  });
}

// POST /api/payments/initialize - start checkout for a listing
router.post("/initialize", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ error: "listingId is required" });

    const listing = await store.listings.get(listingId);
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    if (listing.status !== "available") return res.status(409).json({ error: "This listing has already been sold" });

    const reference = newReference();
    const order = await store.orders.create({
      userId: req.user.id,
      listingId: listing.id,
      reference,
      title: listing.title,
      amount: listing.price,
      currency: "NGN",
      email: req.user.email,
      name: req.user.name,
      notes: String(req.body.notes || "").trim().slice(0, 2000) || null,
    });

    const init = await paystack.initializeTransaction({
      email: req.user.email,
      amountNaira: listing.price,
      reference,
      metadata: { orderId: order.id, listingId: String(listing.id), buyer: req.user.email },
    });

    res.status(201).json({
      message: "Checkout initialized",
      reference,
      authorization_url: init.authorization_url,
      demo: Boolean(init.demo),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/payments/one-tap - charge a previously saved card (tokenized at signup)
router.post("/one-tap", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ error: "listingId is required" });

    const listing = await store.listings.get(listingId);
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    if (listing.status !== "available") return res.status(409).json({ error: "This listing has already been sold" });

    const cardbox = require("../utils/cardbox");
    const user = await store.users.findById(req.user.id);
    if (!user || !user.payment_enc) {
      return res.status(409).json({ error: "No saved card on your account. Save a card to use one-tap checkout." });
    }
    const saved = cardbox.parse(user);
    if (!saved) {
      return res.status(409).json({ error: "No saved card on your account. Save a card to use one-tap checkout." });
    }
    if (saved.pending) {
      return res.status(409).json({ error: "One-tap checkout activates after your first purchase saves your card." });
    }
    if (!saved.authorization_code && !saved.demo) {
      return res.status(409).json({ error: "No saved card on your account. Save a card to use one-tap checkout." });
    }

    const reference = newReference();
    const order = await store.orders.create({
      userId: user.id,
      listingId: listing.id,
      reference,
      title: listing.title,
      amount: listing.price,
      currency: "NGN",
      email: user.email,
      name: user.name,
      notes: String(req.body.notes || "").trim().slice(0, 2000) || null,
    });

    if (saved.demo || !paystack.isConfigured()) {
      await settleOrder(store, order);
      return res.json({ message: "Payment successful (simulated one-tap)", reference, status: "paid", demo: true });
    }

    const charged = await paystack.chargeAuthorization({
      email: user.email,
      amountNaira: listing.price,
      authorizationCode: saved.authorization_code,
      customerCode: saved.customer_code,
      reference,
      metadata: { orderId: order.id, listingId: String(listing.id), buyer: user.email, oneTap: true },
    });
    if (charged.status === "success") {
      await settleOrder(store, order);
      return res.json({ message: "Payment successful", reference, status: "paid", demo: false });
    }

    await store.orders.markFailed(order.reference);
    return res.status(402).json({ error: "Your saved card could not be charged. Please retry with the full checkout." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// GET /api/payments/verify/:reference - check and settle an order
router.get("/verify/:reference", requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const order = await store.orders.findByReference(req.params.reference);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const isOwner = String(order.user_id) === String(req.user.id);
    const isStaff = ["admin", "editor"].includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ error: "You do not have access to this order" });
    }

    if (order.status !== "paid" && paystack.isConfigured()) {
      const tx = await paystack.verifyTransaction(order.reference);
      if (tx.status === "success" && tx.amount >= Math.round(order.amount * 100)) {
        await settleOrder(store, order);
      } else if (tx.status === "failed") {
        await store.orders.markFailed(order.reference);
      }
    }

    const fresh = await store.orders.findByReference(order.reference);
    res.json({ status: fresh.status, order: fresh });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/payments/demo-pay/:reference - simulated payment (demo mode only)
router.post("/demo-pay/:reference", requireAuth, async (req, res) => {
  try {
    if (paystack.isConfigured()) {
      return res.status(403).json({ error: "Demo payments are disabled when Paystack is configured" });
    }
    const store = req.store;
    const order = await store.orders.findByReference(req.params.reference);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (String(order.user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: "You do not have access to this order" });
    }
    if (order.status === "paid") return res.json({ message: "Order already paid", status: "paid" });

    await settleOrder(store, order);
    res.json({ message: "Payment successful (simulated)", status: "paid" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/payments/webhook - Paystack server-to-server events
router.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!paystack.isConfigured()) {
      return res.status(503).json({ error: "Webhooks unavailable in demo mode" });
    }

    const signature = req.headers["x-paystack-signature"];
    if (!paystack.verifyWebhookSignature(req.rawBody, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(req.rawBody.toString("utf8"));
    const store = req.store;

    if (event.event === "charge.success" && event.data && event.data.reference) {
      const order = await store.orders.findByReference(event.data.reference);
      if (order && order.status !== "paid") {
        await settleOrder(store, order);
      }
      // One-tap card capture: webhooks carry the authorization; call the
      // success-settle capture too in case the webhook happened before settle.
      if (order) {
        const buyer = await store.users.findById(order.user_id);
        await captureCard(store, buyer, event.data.authorization, event.data.customer);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(200);
  }
});

// GET /api/payments/orders/:id/download - paid buyer downloads their website
router.get("/orders/:id/download", requireAuthFlexible, async (req, res) => {
  try {
    const store = req.store;
    const order = await store.orders.getById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const isOwner = String(order.user_id) === String(req.user.id);
    const isStaff = ["admin", "editor"].includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ error: "You do not have access to this order" });
    }
    if (order.status !== "paid") {
      return res.status(402).json({ error: "This order has not been paid yet" });
    }

    let listing = null;
    if (order.listing_id) listing = await store.listings.get(order.listing_id);
    const url = listing && listing.delivery_url ? String(listing.delivery_url).trim() : "";

    if (!url) {
      return res.status(404).json({ error: "Delivery file not ready yet - the MITEX team will contact you shortly." });
    }
    res.redirect(302, url);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/payments/orders/mine - current user's orders
router.get("/orders/mine", requireAuth, async (req, res) => {
  try {
    res.json(await req.store.orders.listForUser(req.user.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/payments/orders - staff list all orders
router.get("/orders", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  try {
    res.json(await req.store.orders.listAll(req.query.status));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/payments/refund/:reference - admin refunds an order
router.post("/refund/:reference", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const store = req.store;
    const order = await store.orders.findByReference(req.params.reference);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status === "refunded") return res.status(409).json({ error: "Already refunded" });

    await store.orders.updateStatus(order.reference, "refunded");

    const user = await store.users.findById(order.user_id);
    if (user) {
      const { sendMail, refundEmail } = require("../utils/mailer");
      const mail = refundEmail(user, order);
      setImmediate(() => sendMail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html }).catch(() => {}));
    }

    res.json({ message: "Refund processed", reference: order.reference });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
