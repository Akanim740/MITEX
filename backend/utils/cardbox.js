/**
 * cardbox - encrypted saved-card envelope for one-tap checkout.
 *
 * MITEX never stores card numbers. A customer's `payment_enc` holds ONE of:
 *   { provider:"paystack", demo:true }                       -> demo mode, one-tap settles instantly
 *   { provider:"paystack", pending:true }                    -> opted in; real token captured at first purchase
 *   { provider:"paystack", authorization_code, customer_code,
 *     last4, card_type, reusable }                           -> live one-tap card
 *
 * Web checkout cannot tokenize a card without charging it, so in live mode
 * "save card" records intent and the authorization_code is captured server-side
 * from the first successful purchase (see payments.js verify/webhook).
 */
const cryptoBox = require("./crypto-box");

function parse(user) {
  if (!user || !user.payment_enc) return null;
  try {
    return JSON.parse(cryptoBox.decrypt(user.payment_enc) || "null");
  } catch (err) {
    console.error("cardbox parse failed:", err.message);
    return null;
  }
}

// "one-tap" -> chargeable now | "pending" -> intent recorded, activates after first purchase | null -> none
function readiness(saved) {
  const s = saved || {};
  if (s.demo || s.authorization_code) return "one-tap";
  if (s.pending) return "pending";
  return null;
}

function encrypt(obj) {
  return cryptoBox.encrypt(JSON.stringify(obj));
}

async function storePending(store, userId) {
  await store.users.update(userId, { payment_enc: encrypt({ provider: "paystack", pending: true }) });
  return true;
}

async function storeDemo(store, userId) {
  await store.users.update(userId, { payment_enc: encrypt({ provider: "paystack", demo: true }) });
  return true;
}

async function storeAuthorization(store, userId, auth) {
  const payload = {
    provider: "paystack",
    authorization_code: String(auth.authorization_code || ""),
    customer_code: auth.customer_code || null,
    last4: auth.last4 || null,
    card_type: auth.card_type || null,
    reusable: auth.reusable !== false,
  };
  if (!payload.authorization_code) return false;
  await store.users.update(userId, { payment_enc: encrypt(payload) });
  return payload;
}

async function clear(store, userId) {
  await store.users.update(userId, { payment_enc: null });
  return true;
}

module.exports = { parse, readiness, storePending, storeDemo, storeAuthorization, clear, encrypt };