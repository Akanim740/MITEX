const webpush = require("web-push");

function isConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function vapidDetails() {
  return {
    subject: process.env.VAPID_SUBJECT || "mailto:no-reply@mitex.store",
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  };
}

async function sendToSubscription(sub, payload) {
  if (!sub || !sub.endpoint || !sub.p256dh || !sub.auth) return null;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { vapidDetails: vapidDetails(), TTL: 86400 }
    );
    return true;
  } catch (err) {
    // 404/410 means the subscription is dead - caller should drop it.
    return err.statusCode === 404 || err.statusCode === 410 ? false : null;
  }
}

// Best-effort push to every device registered for a user. Returns counts, never throws.
async function sendPushToUser(store, userId, payload) {
  if (!isConfigured()) return { skipped: true };
  let subs = [];
  try {
    subs = await store.pushSubs.listByUser(userId);
  } catch (e) {
    return { error: e.message };
  }
  let sent = 0;
  for (const sub of subs) {
    const ok = await sendToSubscription(sub, payload);
    if (ok === true) sent++;
    if (ok === false) {
      try {
        await store.pushSubs.removeByEndpoint(sub.endpoint);
      } catch {}
    }
  }
  return { sent, total: subs.length };
}

module.exports = { isConfigured, vapidDetails, sendToSubscription, sendPushToUser };