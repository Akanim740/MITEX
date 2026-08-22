const $ = (sel) => document.querySelector(sel);
const page = document.body.dataset.page;

function esc(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

async function api(path, { method = "GET", body, auth = true, retried = false } = {}) {
  const token = localStorage.getItem("mitex_token");
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && !retried && !path.startsWith("/api/auth/verify")) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) {
      const data = await refreshed.json();
      localStorage.setItem("mitex_token", data.accessToken);
      return api(path, { method, body, auth, retried: true });
    }
    localStorage.removeItem("mitex_token");
    localStorage.removeItem("mitex_user");
    if (page === "account") location.href = "/login.html";
    throw new Error("Session expired. Please sign in again.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showFormError(el, message) {
  el.textContent = message;
  el.classList.remove("hidden");
}

function setLoading(btn, busy, label) {
  btn.disabled = busy;
  btn.textContent = label;
}

if (page === "register") initRegister();
if (page === "login") initLogin();
if (page === "reset") initReset();
if (page === "account") initAccount();
if (page === "marketplace") initMarketplace();
if (page === "demo-checkout") initDemoCheckout();
if (page === "payment-success") initPaymentSuccess();

function naira(value) {
  return "\u20A6" + Number(value).toLocaleString("en-NG");
}

function isLoggedIn() {
  return Boolean(localStorage.getItem("mitex_token"));
}

function statusChip(status) {
  const cls = status === "paid" ? "green" : status === "failed" ? "red" : "gold";
  return `<span class="chip ${cls}">${esc(status)}</span>`;
}

// ---- WebAuthn (fingerprint / face ID) helpers ----
function b64uToBuf(b64u) {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufToB64u(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toCreationOptions(json) {
  return {
    publicKey: {
      challenge: b64uToBuf(json.challenge),
      rp: json.rp,
      user: { id: b64uToBuf(json.user.id), name: json.user.name, displayName: json.user.displayName },
      pubKeyCredParams: json.pubKeyCredParams,
      timeout: json.timeout,
      excludeCredentials: (json.excludeCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })),
      authenticatorSelection: json.authenticatorSelection,
      attestation: json.attestation,
    },
  };
}

function toRequestOptions(json) {
  return {
    publicKey: {
      challenge: b64uToBuf(json.challenge),
      rpId: json.rpId,
      timeout: json.timeout,
      allowCredentials: (json.allowCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })),
      userVerification: json.userVerification,
    },
  };
}

function credResponseJson(cred) {
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      attestationObject: cred.response.attestationObject ? bufToB64u(cred.response.attestationObject) : undefined,
      authenticatorData: cred.response.authenticatorData ? bufToB64u(cred.response.authenticatorData) : undefined,
      signature: cred.response.signature ? bufToB64u(cred.response.signature) : undefined,
      userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : undefined,
    },
  };
}

function webauthnSupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
}

function friendlyAuthError(err) {
  if (err && err.name === "NotAllowedError") return "Fingerprint/Face scan was cancelled or did not match.";
  if (err && err.name === "NotSupportedError") return "This browser or device does not support biometric sign-in.";
  if (err && err.name === "InvalidStateError") return "This device is already registered.";
  return err.message;
}

function passwordScore(value) {
  let score = 0;
  if (value.length >= 8) score++;
  if (/[A-Za-z]/.test(value) && /[0-9]/.test(value)) score++;
  if (value.length >= 12 || /[^A-Za-z0-9]/.test(value)) score++;
  return score;
}

function initRegister() {
  const passInput = $("#rPass");
  const bars = [$("#s1"), $("#s2"), $("#s3")];
  const label = $("#strengthLabel");

  passInput.addEventListener("input", () => {
    const score = passwordScore(passInput.value);
    bars.forEach((b, i) => {
      b.className = "";
      if (i < score) b.classList.add(score === 1 ? "on-weak" : score === 2 ? "on-mid" : "on-strong");
    });
    label.textContent =
      passInput.value.length === 0
        ? "Password strength"
        : ["Too weak", "Weak", "Good", "Strong"][score];
  });

  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#formError");
    errEl.classList.add("hidden");

    const name = $("#rName").value.trim();
    const email = $("#rEmail").value.trim();
    const password = passInput.value;

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return showFormError(errEl, "Password must be at least 8 characters and include letters and numbers.");
    }

    const btn = $("#submitBtn");
    setLoading(btn, true, "Creating account...");
    try {
      const data = await api("/api/auth/register", { method: "POST", auth: false, body: { name, email, password } });
      $("#registerForm").classList.add("hidden");
      $("#successBox").classList.remove("hidden");
      $("#successMsg").textContent = data.message;

      if (data.devToken) {
        $("#devBox").classList.remove("hidden");
        $("#devVerifyBtn").addEventListener("click", async () => {
          setLoading($("#devVerifyBtn"), true, "Verifying...");
          try {
            const v = await api(`/api/auth/verify-email?token=${encodeURIComponent(data.devToken)}`, { auth: false });
            $("#devVerifyBtn").textContent = "Verified";
            $("#devVerifyBtn").disabled = true;
            $("#successMsg").textContent = v.message;
          } catch (err) {
            $("#successMsg").textContent = err.message;
          }
        });
      }
    } catch (err) {
      showFormError(errEl, err.message);
      setLoading(btn, false, "Create Account");
    }
  });
}

function initLogin() {
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#formError");
    errEl.classList.add("hidden");

    const btn = $("#submitBtn");
    setLoading(btn, true, "Signing in...");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        auth: false,
        body: { email: $("#lEmail").value.trim(), password: $("#lPass").value },
      });
      localStorage.setItem("mitex_token", data.accessToken);
      localStorage.setItem("mitex_user", JSON.stringify(data.user));
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/") ? next : "/account.html";
    } catch (err) {
      showFormError(errEl, err.message);
      setLoading(btn, false, "Sign In");
    }
  });

  const bioBtn = $("#biometricBtn");
  if (bioBtn && webauthnSupported()) {
    bioBtn.classList.remove("hidden");
    bioBtn.addEventListener("click", biometricLogin);
  }
}

async function biometricLogin() {
  const errEl = $("#formError");
  errEl.classList.add("hidden");
  const email = $("#lEmail").value.trim();
  if (!email) {
    return showFormError(errEl, "Type your email above first, then tap fingerprint login.");
  }

  const btn = $("#biometricBtn");
  setLoading(btn, true, "Waiting for fingerprint...");
  try {
    const options = await api("/api/auth/webauthn/login/options", { method: "POST", body: { email } });
    const assertion = await navigator.credentials.get(toRequestOptions(options));
    const data = await api("/api/auth/webauthn/login/verify", {
      method: "POST",
      body: { email, response: credResponseJson(assertion) },
    });
    localStorage.setItem("mitex_token", data.accessToken);
    localStorage.setItem("mitex_user", JSON.stringify(data.user));
    const next = new URLSearchParams(location.search).get("next");
    location.href = next && next.startsWith("/") ? next : "/account.html";
  } catch (err) {
    showFormError(errEl, friendlyAuthError(err));
    setLoading(btn, false, "Use fingerprint or face ID");
  }
}

function initReset() {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");

  if (token) {
    $("#requestMode").classList.add("hidden");
    $("#resetMode").classList.remove("hidden");

    $("#resetForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $("#resetError");
      errEl.classList.add("hidden");

      const newPassword = $("#npPass").value;
      if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return showFormError(errEl, "Password must be at least 8 characters and include letters and numbers.");
      }

      const btn = $("#resetBtn");
      setLoading(btn, true, "Updating...");
      try {
        await api("/api/auth/reset-password", {
          method: "POST",
          auth: false,
          body: { token, newPassword },
        });
        $("#resetMode").classList.add("hidden");
        $("#doneBox").classList.remove("hidden");
      } catch (err) {
        showFormError(errEl, err.message);
        setLoading(btn, false, "Update Password");
      }
    });
    return;
  }

  $("#requestForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgEl = $("#requestMsg");
    msgEl.className = "muted";
    msgEl.textContent = "Sending...";

    try {
      const data = await api("/api/auth/forgot-password", {
        method: "POST",
        auth: false,
        body: { email: $("#fpEmail").value.trim() },
      });
      msgEl.textContent = data.message;
      if (data.devResetUrl) {
        msgEl.innerHTML = `${esc(data.message)}<br /><strong>Developer mode:</strong> open this link to reset: <a style="color:#fbbf24" href="${esc(data.devResetUrl)}">Reset link</a>`;
      }
    } catch (err) {
      msgEl.className = "error";
      msgEl.textContent = err.message;
    }
  });
}

function initAccount() {
  wireDropdown();

  $("#logoutBtn").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", auth: false });
    } catch {}
    localStorage.removeItem("mitex_token");
    localStorage.removeItem("mitex_user");
    location.href = "/index.html";
  });

  $("#menuProfile").addEventListener("click", () => closeDropdown());
  $("#menuSecurity").addEventListener("click", () => closeDropdown());

  loadProfile().catch((err) => console.error(err));
}

function wireDropdown() {
  const dd = document.querySelector("[data-dropdown]");
  const btn = dd.querySelector(".drop-btn");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = dd.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => dd.classList.remove("open"));
  document.addEventListener("keydown", (e) => e.key === "Escape" && dd.classList.remove("open"));
}

function closeDropdown() {
  document.querySelector("[data-dropdown]")?.classList.remove("open");
}

let currentUser = null;

async function loadProfile() {
  try {
    currentUser = await api("/api/auth/me");
  } catch {
    return;
  }

  const initial = (currentUser.name || "?").charAt(0).toUpperCase();
  $("#topAvatar").textContent = initial;
  $("#topName").textContent = (currentUser.name || "Account").split(" ")[0];
  $("#bigAvatar").textContent = initial;
  $("#pName").textContent = currentUser.name;
  $("#pEmail").textContent = currentUser.email;
  $("#pRole").textContent = currentUser.role;
  $("#pJoined").textContent = currentUser.created_at
    ? new Date(currentUser.created_at).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })
    : "-";

  const verifiedChip = $("#pVerified");
  if (currentUser.email_verified) {
    verifiedChip.textContent = "verified";
    verifiedChip.className = "chip green";
  } else {
    verifiedChip.textContent = "unverified";
    verifiedChip.className = "chip red";
    $("#verifyBanner").classList.remove("hidden");
  }

  const isStaff = currentUser.role === "admin" || currentUser.role === "editor";
  if (isStaff) {
    $("#menuDashboard").classList.remove("hidden");
  }

  $("#eName").value = currentUser.name || "";
  $("#ePhone").value = currentUser.phone || "";
  $("#eAvatar").value = currentUser.avatar_url || "";
  $("#eBio").value = currentUser.bio || "";

  if (currentUser.avatar_url) {
    $("#bigAvatar").innerHTML = `<img src="${esc(currentUser.avatar_url)}" alt="avatar" onerror="this.remove()" />`;
  }

  $("#resendBtn").addEventListener("click", resendVerification);
  $("#devVerifyBtn").addEventListener("click", devVerify);
  $("#profileForm").addEventListener("submit", saveProfile);
  $("#passwordForm").addEventListener("submit", changePassword);

  initBiometrics();
  loadMyOrders();
}

function initBiometrics() {
  const addBtn = $("#addPasskeyBtn");
  if (!addBtn) return;

  if (!webauthnSupported()) {
    addBtn.disabled = true;
    addBtn.textContent = "Biometrics not supported in this browser";
    return;
  }

  addBtn.addEventListener("click", registerPasskey);
  loadPasskeys();
}

async function registerPasskey() {
  const btn = $("#addPasskeyBtn");
  setLoading(btn, true, "Waiting for your device...");
  try {
    const options = await api("/api/auth/webauthn/register/options", { method: "POST" });
    const credential = await navigator.credentials.create(toCreationOptions(options));
    await api("/api/auth/webauthn/register/verify", { method: "POST", body: credResponseJson(credential) });
    showBioMsg("Enabled! Next time you can sign in with your fingerprint or face.");
    loadPasskeys();
  } catch (err) {
    showBioMsg(friendlyAuthError(err));
  } finally {
    setLoading(btn, false, "Enable fingerprint / face ID");
  }
}

async function loadPasskeys() {
  const list = $("#passkeyList");
  if (!list) return;
  try {
    const creds = await api("/api/auth/webauthn/credentials");
    if (!creds.length) {
      list.innerHTML = '<li class="muted">No biometric devices yet.</li>';
      return;
    }
    list.innerHTML = "";
    creds.forEach((c) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${c.device_type === "multiDevice" ? "Synced passkey" : "This device"} <span class="muted">- added ${new Date(c.created_at).toLocaleDateString("en-NG")}${c.backed_up ? " - backed up" : ""}</span></span>
        <button type="button" class="btn btn-ghost btn-sm">Remove</button>`;
      li.querySelector("button").addEventListener("click", async () => {
        if (!confirm("Remove biometric sign-in for this device?")) return;
        try {
          await api(`/api/auth/webauthn/credentials/${c.id}`, { method: "DELETE" });
          loadPasskeys();
        } catch (err) {
          alert(err.message);
        }
      });
      list.appendChild(li);
    });
  } catch {
    list.innerHTML = "";
  }
}

function showBioMsg(text) {
  const el = $("#biometricMsg");
  el.textContent = text;
  el.classList.remove("hidden");
}

async function loadMyOrders() {
  const panel = document.querySelector("#orders-panel");
  if (!panel) return;
  const body = $("#ordersBody");
  try {
    const orders = await api("/api/payments/orders/mine");
    if (!orders.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">No orders yet. <a href="/marketplace.html" style="color:#fbbf24">Browse the marketplace</a>.</td></tr>';
      return;
    }
    body.innerHTML = orders
      .map(
        (o) => `
        <tr>
          <td><strong>${esc(o.title)}</strong><br /><span class="muted">${esc(o.reference)}</span></td>
          <td>${naira(o.amount)}</td>
          <td>${statusChip(o.status)}${
            o.status === "paid"
              ? ` <a class="btn btn-sm btn-primary" href="/api/payments/orders/${encodeURIComponent(o.id)}/download" target="_blank" rel="noopener" style="margin-left:8px">Download</a>`
              : ""
          }</td>
          <td class="muted">${new Date(o.created_at).toLocaleDateString("en-NG")}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="4" class="error">${esc(err.message)}</td></tr>`;
  }
}

function renderMarketNav() {
  const area = $("#navAuthArea");
  if (isLoggedIn()) {
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem("mitex_user"));
    } catch {}
    const initial = (user && user.name ? user.name : "?").charAt(0).toUpperCase();
    area.innerHTML = `
      <div style="display:flex;gap:18px;align-items:center;">
        <a href="/index.html" style="color:var(--muted);text-decoration:none;">Home</a>
        <div class="dropdown" data-dropdown>
          <button class="drop-btn" type="button" aria-expanded="false">
            <span class="avatar">${esc(initial)}</span> Account
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="drop-menu">
            <a href="/account.html">My Account</a>
            <a href="/account.html#orders-panel">My Orders</a>
            <button type="button" class="danger" id="mktLogout">Log out</button>
          </div>
        </div>
      </div>`;
    wireDropdown();
    $("#mktLogout").addEventListener("click", async () => {
      try { await api("/api/auth/logout", { method: "POST", auth: false }); } catch {}
      localStorage.removeItem("mitex_token");
      localStorage.removeItem("mitex_user");
      location.reload();
    });
  } else {
    area.innerHTML = `
      <div style="display:flex;gap:18px;align-items:center;">
        <a href="/index.html" style="color:var(--muted);text-decoration:none;">Home</a>
        <a href="/login.html?next=/marketplace.html" style="color:var(--muted);text-decoration:none;">Sign In</a>
        <a href="/register.html?next=/marketplace.html" class="btn btn-primary btn-sm">Get Started</a>
      </div>`;
  }
}

let marketplaceListings = [];

async function initMarketplace() {
  renderMarketNav();
  const grid = $("#listingsGrid");
  const searchInput = $("#marketSearch");
  try {
    marketplaceListings = await api("/api/listings", { auth: false });
    if (!marketplaceListings.length) {
      grid.innerHTML = '<p class="empty-market">No premium websites are available right now. Check back soon or call +234 7011633770.</p>';
      return;
    }
    if (searchInput) {
      searchInput.addEventListener("input", () => renderListings(searchInput.value));
    }
    renderListings("");
  } catch (err) {
    grid.innerHTML = `<p class="empty-market">${esc(err.message)}</p>`;
  }
}

function renderListings(query) {
  const grid = $("#listingsGrid");
  const count = $("#resultCount");
  const q = (query || "").trim().toLowerCase();

  const matches = !q
    ? marketplaceListings
    : marketplaceListings.filter((l) =>
        [l.title, l.description, l.tech_stack, l.level != null ? `level ${l.level}` : ""]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      );

  if (count) {
    count.textContent = q
      ? `${matches.length} website${matches.length === 1 ? "" : "s"} found for "${query.trim()}"`
      : `${matches.length} website${matches.length === 1 ? "" : "s"} available`;
  }

  if (!matches.length) {
    grid.innerHTML = '<p class="empty-market">No websites match your search. Try a different keyword - or request a custom build on our homepage.</p>';
    return;
  }

  grid.innerHTML = matches
    .map(
      (l) => `
      <article class="listing-card">
        <div class="chips" style="justify-content:flex-start;">
          ${l.level ? `<span class="chip gold">Level ${l.level}</span>` : ""}
          <span class="chip">${esc(l.status)}</span>
        </div>
        <h3>${esc(l.title)}</h3>
        <p>${esc(l.description)}</p>
        ${l.tech_stack ? `<div class="tech-row">${l.tech_stack.split(",").map((t) => `<span class="chip">${esc(t.trim())}</span>`).join("")}</div>` : ""}
        <div class="price">${naira(l.price)}</div>
        <button class="btn btn-primary btn-full" data-buy="${l.id}">Buy Now</button>
      </article>`
    )
    .join("");

  grid.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", () => buyListing(btn.dataset.buy, btn));
  });
}

async function buyListing(listingId, btn) {
  if (!isLoggedIn()) {
    location.href = "/login.html?next=/marketplace.html";
    return;
  }
  setLoading(btn, true, "Starting checkout...");
  try {
    const data = await api("/api/payments/initialize", { method: "POST", body: { listingId } });
    location.href = data.authorization_url;
  } catch (err) {
    alert(err.message);
    setLoading(btn, false, "Buy Now");
  }
}

async function initDemoCheckout() {
  if (!isLoggedIn()) {
    location.href = "/login.html?next=" + encodeURIComponent(location.pathname + location.search);
    return;
  }

  const reference = new URLSearchParams(location.search).get("reference");
  if (!reference) {
    showFormError($("#checkoutError"), "Missing payment reference.");
    return;
  }

  try {
    const { order } = await api(`/api/payments/verify/${encodeURIComponent(reference)}`);
    $("#oRef").textContent = order.reference;

    if (order.status === "paid") {
      $("#orderBox").classList.add("hidden");
      $("#paidBox").classList.remove("hidden");
      return;
    }

    $("#oTitle").textContent = order.title;
    $("#oAmount").textContent = naira(order.amount);
    const payBtn = $("#payBtn");
    payBtn.disabled = false;
    payBtn.textContent = `Pay ${naira(order.amount)} (Simulated)`;
    payBtn.addEventListener("click", async () => {
      setLoading(payBtn, true, "Processing...");
      try {
        await api(`/api/payments/demo-pay/${encodeURIComponent(reference)}`, { method: "POST" });
        location.href = `/payment-success.html?reference=${encodeURIComponent(reference)}`;
      } catch (err) {
        showFormError($("#checkoutError"), err.message);
        setLoading(payBtn, false, `Pay ${naira(order.amount)} (Simulated)`);
      }
    });
  } catch (err) {
    showFormError($("#checkoutError"), err.message);
  }
}

async function initPaymentSuccess() {
  const reference = new URLSearchParams(location.search).get("reference");
  if (!reference) {
    setPaymentStatus("❓", "No payment reference", "Start a new checkout from the marketplace.", true);
    return;
  }

  try {
    const { status } = await api(`/api/payments/verify/${encodeURIComponent(reference)}`);
    if (status === "paid") {
      setPaymentStatus("✅", "Payment successful!", "Your order is confirmed. The MITEX team will contact you with next steps.", true);
    } else if (status === "failed") {
      setPaymentStatus("❌", "Payment failed", "You can retry checkout from the marketplace.", true);
    } else {
      setTimeout(() => initPaymentSuccess(), 3000);
    }
  } catch (err) {
    setPaymentStatus("⚠️", "Could not confirm payment", err.message, true);
  }
}

function setPaymentStatus(icon, title, text, showActions) {
  $("#statusIcon").textContent = icon;
  $("#statusTitle").textContent = title;
  $("#statusText").textContent = text;
  if (showActions) $("#statusActions").classList.remove("hidden");
}

async function resendVerification() {
  const btn = $("#resendBtn");
  setLoading(btn, true, "Sending...");
  try {
    const data = await api("/api/auth/resend-verification", { method: "POST" });
    if (data.devToken) {
      window.__devVerifyToken = data.devToken;
      $("#devVerifyBox").classList.remove("hidden");
    }
    btn.textContent = "Email sent";
  } catch (err) {
    btn.textContent = err.message;
    setTimeout(() => setLoading(btn, false, "Resend verification email"), 2500);
  }
}

async function devVerify() {
  const token = window.__devVerifyToken;
  if (!token) return;
  try {
    const v = await api(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, { auth: false });
    $("#devVerifyBox").classList.add("hidden");
    $("#verifyBanner").classList.add("hidden");
    verifiedChipUpdate(v);
  } catch (err) {
    alert(err.message);
  }
}

function verifiedChipUpdate() {
  const chip = $("#pVerified");
  chip.textContent = "verified";
  chip.className = "chip green";
}

async function saveProfile(e) {
  e.preventDefault();
  const msg = $("#profileMsg");
  msg.classList.add("hidden");

  const btn = $("#profileSaveBtn");
  setLoading(btn, true, "Saving...");
  try {
    const data = await api("/api/users/me", {
      method: "PUT",
      body: {
        name: $("#eName").value.trim(),
        phone: $("#ePhone").value.trim(),
        avatar_url: $("#eAvatar").value.trim(),
        bio: $("#eBio").value.trim(),
      },
    });

    currentUser = data.user;
    localStorage.setItem("mitex_user", JSON.stringify(data.user));
    $("#topName").textContent = (data.user.name || "Account").split(" ")[0];
    $("#bigAvatar").textContent = (data.user.name || "?").charAt(0).toUpperCase();
    $("#pName").textContent = data.user.name;
    $("#pPhone").textContent = data.user.phone || "-";
    $("#pBio").textContent = data.user.bio || "-";
    if (data.user.avatar_url) {
      $("#bigAvatar").innerHTML = `<img src="${esc(data.user.avatar_url)}" alt="avatar" onerror="this.remove()" />`;
    }

    msg.textContent = "Saved.";
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 2500);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "error";
    msg.classList.remove("hidden");
  } finally {
    setLoading(btn, false, "Save Changes");
  }
}

async function changePassword(e) {
  e.preventDefault();
  const errEl = $("#passError");
  errEl.classList.add("hidden");

  const newPassword = $("#newPass").value;
  if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return showFormError(errEl, "New password must be at least 8 characters and include letters and numbers.");
  }

  const btn = $("#passSaveBtn");
  setLoading(btn, true, "Updating...");
  try {
    await api("/api/users/me/password", {
      method: "POST",
      body: { currentPassword: $("#curPass").value, newPassword },
    });
    localStorage.removeItem("mitex_token");
    localStorage.removeItem("mitex_user");
    alert("Password changed. Please sign in again.");
    location.href = "/login.html";
  } catch (err) {
    showFormError(errEl, err.message);
    setLoading(btn, false, "Update Password");
  }
}
