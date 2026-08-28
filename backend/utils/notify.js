const push = require("./push");

// Write an in-app notification and fire a web push to the user's devices.
// Both channels are best-effort and never throw.
async function notifyUser(store, { userId, type, title, body, link }) {
  let notif = null;
  try {
    notif = await store.notifications.create({ userId, type, title, body, link });
  } catch (e) {
    console.error("notification create failed:", e.message);
  }
  try {
    await push.sendPushToUser(store, userId, {
      title,
      body: body || "",
      link: link || "/marketplace.html",
    });
  } catch (e) {
    console.error("notification push failed:", e.message);
  }
  return notif;
}

module.exports = { notifyUser };