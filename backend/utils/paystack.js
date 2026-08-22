const crypto = require("crypto");

const SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const isConfigured = () => Boolean(SECRET);

async function initializeTransaction({ email, amountNaira, reference, metadata }) {
  if (!isConfigured()) {
    return {
      demo: true,
      authorization_url: `${APP_URL}/checkout-demo.html?reference=${encodeURIComponent(reference)}`,
      access_code: null,
      reference,
    };
  }

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: Math.round(amountNaira * 100),
      reference,
      currency: "NGN",
      callback_url: `${APP_URL}/payment-success.html?reference=${encodeURIComponent(reference)}`,
      metadata,
    }),
  });

  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack initialization failed");
  }
  return { ...data.data, demo: false };
}

async function verifyTransaction(reference) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack verification failed");
  }
  return data.data;
}

function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;
  const hash = crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

module.exports = { isConfigured, initializeTransaction, verifyTransaction, verifyWebhookSignature };
