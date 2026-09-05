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
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    if (data.code) err.code = data.code;
    throw err;
  }
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

if (page === "marketplace" || page === "account") initNotifications();

function naira(value) {
  if (typeof formatPriceWithOriginal === "function") {
    const cc = localStorage.getItem("mitex_country") || "NG";
    return formatPriceWithOriginal(value, cc);
  }
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

  if (typeof detectCountry === "function" && !localStorage.getItem("mitex_country")) {
    const cc = detectCountry();
    localStorage.setItem("mitex_country", cc);
    localStorage.setItem("mitex_locale", typeof detectLocale === "function" ? detectLocale(cc) : "en");
  }

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

  const dobs = document.querySelectorAll('input[type="date"]');
  dobs.forEach((el) => (el.max = new Date().toISOString().split("T")[0]));

  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#formError");
    errEl.classList.add("hidden");

    const name = $("#rName").value.trim();
    const email = $("#rEmail").value.trim();
    const password = passInput.value;
    const dob = $("#rDob") ? $("#rDob").value : "";
    const saveCard = $("#rSaveCard") ? $("#rSaveCard").checked : false;

    if (!dob) {
      return showFormError(errEl, "Your date of birth is required (you must be 18 or older).");
    }

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return showFormError(errEl, "Password must be at least 8 characters and include letters and numbers.");
    }

    const btn = $("#submitBtn");
    setLoading(btn, true, "Creating account...");
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        auth: false,
        body: { name, email, dob, saveCard, password, country: localStorage.getItem("mitex_country") || "NG", locale: localStorage.getItem("mitex_locale") || "en" },
      });
      $("#registerForm").classList.add("hidden");
      $("#successBox").classList.remove("hidden");
      $("#successMsg").textContent =
        data.message +
        (data.payment_saved
          ? " One-tap checkout is enabled."
          : data.payment_pending
            ? " One-tap checkout is enabled - it activates after your first purchase saves your card."
            : "");

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
      if (data.user.country) localStorage.setItem("mitex_country", data.user.country);
      if (data.user.locale) localStorage.setItem("mitex_locale", data.user.locale);
      const next = new URLSearchParams(location.search).get("next");
      if (next && next.startsWith("/")) location.href = next;
      else if (data.user.role === "staff") location.href = "/worker.html";
      else location.href = "/account.html";
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
    if (next && next.startsWith("/")) location.href = next;
    else if (data.user.role === "staff") location.href = "/worker.html";
    else location.href = "/account.html";
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
  const user = JSON.parse(localStorage.getItem("mitex_user") || "{}");
  if (user.role === "staff") { location.href = "/worker.html"; return; }

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
  localStorage.setItem("mitex_user", JSON.stringify(currentUser));
  if (currentUser.country) localStorage.setItem("mitex_country", currentUser.country);
  if (currentUser.locale) localStorage.setItem("mitex_locale", currentUser.locale);

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
  const eDobEl = $("#eDob");
  if (eDobEl) {
    eDobEl.max = new Date().toISOString().split("T")[0];
    eDobEl.value = currentUser.dob || "";
  }

  if (currentUser.avatar_url) {
    $("#bigAvatar").innerHTML = `<img src="${esc(currentUser.avatar_url)}" alt="avatar" onerror="this.remove()" />`;
  }

  $("#resendBtn").addEventListener("click", resendVerification);
  $("#devVerifyBtn").addEventListener("click", devVerify);
  $("#profileForm").addEventListener("submit", saveProfile);
  $("#passwordForm").addEventListener("submit", changePassword);

  wireCardPanel(currentUser);

  if (typeof CURRENCIES !== "undefined" && typeof LANG_LABELS !== "undefined") {
    const ccSel = $("#eCountry");
    const localeSel = $("#eLocale");
    if (ccSel) {
      ccSel.innerHTML = Object.entries(CURRENCIES)
        .filter(([code, cur], i, arr) => arr.findIndex(([c]) => c === code) === i)
        .map(([code, cur]) => `<option value="${code}"${code === (currentUser.country || "NG") ? " selected" : ""}>${cur.name} (${cur.symbol})</option>`)
        .join("");
    }
    if (localeSel) {
      localeSel.innerHTML = Object.entries(LANG_LABELS)
        .map(([code, name]) => `<option value="${code}"${code === (currentUser.locale || "en") ? " selected" : ""}>${name}</option>`)
        .join("");
    }
    const prefsForm = $("#prefsForm");
    if (prefsForm) {
      prefsForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const newCountry = $("#eCountry").value;
        const newLocale = $("#eLocale").value;
        try {
          await api("/api/users/me", { method: "PUT", body: { country: newCountry, locale: newLocale } });
          localStorage.setItem("mitex_country", newCountry);
          localStorage.setItem("mitex_locale", newLocale);
          const msg = $("#prefsMsg");
          msg.classList.remove("hidden");
          setTimeout(() => msg.classList.add("hidden"), 2500);
        } catch (err) {
          alert(err.message);
        }
      });
    }
  }

  initBiometrics();
  loadMyOrders();

  const delBtn = $("#delAccountBtn");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      const password = $("#delPass").value;
      if (!password) return alert("Enter your password to confirm deletion.");
      if (!confirm("This will permanently deactivate your account. Your purchases and data will be anonymized. Continue?")) return;
      delBtn.disabled = true;
      delBtn.textContent = "Deleting...";
      try {
        await api("/api/users/me", { method: "DELETE", body: { password } });
        localStorage.removeItem("mitex_token");
        localStorage.removeItem("mitex_user");
        localStorage.removeItem("mitex_country");
        localStorage.removeItem("mitex_locale");
        location.href = "/index.html";
      } catch (err) {
        const msg = $("#delMsg");
        msg.textContent = err.message;
        msg.classList.remove("hidden");
        delBtn.disabled = false;
        delBtn.textContent = "Delete my account";
      }
    });
  }
}

function wireCardPanel(user) {
  const enableBtn = $("#enableCardBtn");
  const disableBtn = $("#disableCardBtn");
  const msg = $("#cardMsg");
  if (!enableBtn && !disableBtn) return;

  const renderCard = (paymentSaved, paymentPending) => {
    const active = Boolean(paymentSaved) || Boolean(paymentPending);
    if (enableBtn) enableBtn.classList.toggle("hidden", active);
    if (disableBtn) disableBtn.classList.toggle("hidden", !active);
    if (msg) {
      if (paymentSaved) msg.textContent = "One-tap checkout is enabled — your card is securely saved for one-click purchases.";
      else if (paymentPending) msg.textContent = "One-tap checkout is enabled. It activates after your next purchase saves your card.";
      else msg.textContent = "No saved card yet.";
    }
  };

  renderCard(user && user.payment_saved, user && user.payment_pending);

  if (enableBtn) {
    enableBtn.addEventListener("click", async () => {
      if (!confirm("This enables one-click checkout using the card you pay with. In demo mode this is simulated immediately - continue?")) return;
      enableBtn.disabled = true;
      enableBtn.textContent = "Saving...";
      try {
        const data = await api("/api/users/me", { method: "PUT", body: { saveCard: true } });
        currentUser = data.user;
        renderCard(Boolean(data.user && data.user.payment_saved), Boolean(data.user && data.user.payment_pending));
        enableBtn.disabled = false;
        enableBtn.textContent = "Save card for one-tap checkout";
      } catch (err) {
        alert(err.message);
        enableBtn.disabled = false;
        enableBtn.textContent = "Save card for one-tap checkout";
      }
    });
  }
  if (disableBtn) {
    disableBtn.addEventListener("click", async () => {
      if (!confirm("Disable one-tap checkout and remove the saved card?")) return;
      disableBtn.disabled = true;
      try {
        const data = await api("/api/users/me", { method: "PUT", body: { saveCard: false } });
        const fresh = data.user || currentUser;
        currentUser = fresh;
        renderCard(false, false);
        disableBtn.disabled = false;
      } catch (err) {
        alert(err.message);
        disableBtn.disabled = false;
      }
    });
  }
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
let marketplacePage = 1;
const MARKET_PAGE_SIZE = 8;
let marketplaceCanOneTap = false;

function skeletonCards(n = 6) {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `
      <article class="listing-card" aria-hidden="true">
        <div class="skel" style="height:14px;width:60%;"></div>
        <div class="skel" style="height:22px;width:85%;"></div>
        <div class="skel" style="height:14px;width:100%;"></div>
        <div class="skel" style="height:14px;width:70%;"></div>
        <div class="skel" style="height:34px;width:100%;"></div>
      </article>`;
  }
  return out;
}

async function initMarketplace() {
  renderMarketNav();
  if (typeof applyTranslations === "function") applyTranslations();
  if (typeof initLangSwitcher === "function") initLangSwitcher();
  const grid = $("#listingsGrid");
  const searchInput = $("#marketSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      marketplacePage = 1;
      renderListings(searchInput.value);
    });
    const q = new URLSearchParams(location.search).get("q");
    if (q) {
      searchInput.value = q;
      marketplacePage = 1;
    }
  }
  initMarketStats();
  grid.innerHTML = skeletonCards();
  try {
    marketplaceListings = await api("/api/listings", { auth: false });
    if (isLoggedIn()) {
      try {
        const me = await api("/api/auth/me");
        marketplaceCanOneTap = Boolean(me && me.payment_saved);
      } catch {
        marketplaceCanOneTap = false;
      }
    }
    renderListings(searchInput ? searchInput.value : "");
  } catch (err) {
    grid.innerHTML = `<p class="empty-market">${esc(err.message)}</p>`;
  }
}

async function initMarketStats() {
  const holder = $("#marketStats");
  if (!holder) return;
  try {
    const s = await api("/api/listings/stats", { auth: false });
    const chips = [];
    if (s.available >= 0) chips.push(`<span class="stat-chip"><strong>${s.available}</strong> ${t("market_count_many")}</span>`);
    if (s.sold > 0) chips.push(`<span class="stat-chip"><strong>${s.sold}</strong> sold on MITEX</span>`);
    if (s.delivered > 0) chips.push(`<span class="stat-chip"><strong>${s.delivered}</strong> ready to buy now</span>`);
    holder.innerHTML = `<div class="market-stats">${chips.join("")}</div>`;
    const ticker = $("#soldTicker");
    if (ticker && Array.isArray(s.recentSold) && s.recentSold.length) {
      ticker.innerHTML = s.recentSold
        .map((o) => `<li><span class="ticker-dot"></span>${esc(o.title)} &middot; ${naira(Number(o.price))}</li>`)
        .join("");
      ticker.parentElement.style.display = "block";
    }
  } catch {
    holder.innerHTML = "";
  }
}

function shareListing(l) {
  const url = `${location.origin}/marketplace.html?q=${encodeURIComponent(l.title)}`;
  const text = `${l.title} — ${l.status === "available" ? (l.deliveryReady ? "Buy it now" : "Almost ready — save your spot") : "Sold on MITEX"}: ${naira(Number(l.price))}`;
  if (navigator.share) {
    navigator.share({ title: l.title, text, url }).catch(() => {});
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
  }
}

function initLangSwitcher() {
  const btn = $("#langBtn");
  const dropdown = $("#langDropdown");
  const label = $("#langLabel");
  if (!btn || !dropdown) return;

  const cc = localStorage.getItem("mitex_country") || "NG";
  const cur = typeof getCurrency === "function" ? getCurrency(cc) : { code: "NGN" };
  label.textContent = (localStorage.getItem("mitex_locale") || "en").toUpperCase();

  const langEntries = typeof LANG_LABELS !== "undefined" ? Object.entries(LANG_LABELS) : [["en", "English"]];
  dropdown.innerHTML = langEntries
    .map(([code, name]) => `<button type="button" data-lang="${code}" style="display:block;width:100%;text-align:left;padding:7px 10px;border:none;background:none;color:var(--text);cursor:pointer;border-radius:6px;font-size:0.84rem;${code === (localStorage.getItem("mitex_locale") || "en") ? "background:rgba(251,191,36,.15);color:#fbbf24;" : ""}">${name}</button>`)
    .join("");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", () => { dropdown.style.display = "none"; });

  dropdown.querySelectorAll("[data-lang]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const locale = b.dataset.lang;
      if (typeof setLocale === "function") setLocale(locale);
      label.textContent = locale.toUpperCase();
      dropdown.style.display = "none";
      renderListings($("#marketSearch") ? $("#marketSearch").value : "");
    });
  });
}

function renderListings(query, page) {
  const grid = $("#listingsGrid");
  const count = $("#resultCount");
  const pager = $("#pager");
  const q = (query || "").trim().toLowerCase();
  const pg = Math.max(1, page || marketplacePage);

  const matches = !q
    ? marketplaceListings
    : marketplaceListings.filter((l) =>
        [l.title, l.description, l.tech_stack, l.level != null ? `level ${l.level}` : ""]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      );

  if (count) {
    count.textContent = q
      ? `${matches.length} ${matches.length === 1 ? t("market_found_one") : t("market_found_many")} "${query.trim()}"`
      : `${matches.length} ${matches.length === 1 ? t("market_count_one") : t("market_count_many")}`;
  }

  if (!matches.length) {
    grid.innerHTML = `<p class="empty-market">${t("market_no_match")}</p>`;
    if (pager) pager.style.display = "none";
    return;
  }

  const totalPages = Math.ceil(matches.length / MARKET_PAGE_SIZE);
  if (pg > totalPages) { marketplacePage = totalPages; renderListings(query, totalPages); return; }
  const pageItems = matches.slice((pg - 1) * MARKET_PAGE_SIZE, pg * MARKET_PAGE_SIZE);

  grid.innerHTML = pageItems
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
        ${
          l.employee
            ? `<div class="handled-by">Handled by <strong>${esc(l.employee.name)}</strong>${
                l.employee.phone
                  ? ` &middot; <a href="https://wa.me/${esc(String(l.employee.phone).replace(/[^0-9]/g, ""))}" target="_blank" rel="noopener">WhatsApp</a>`
                  : ""
              }</div>`
            : ""
        }
        ${
          l.status === "available" && l.deliveryReady === false
            ? `<span class="chip gold">Almost ready</span>
               <button class="btn btn-full" data-intent="${l.id}" style="margin-top:8px;">Notify me</button>`
            : l.status === "available"
            ? `<button class="btn btn-primary btn-full" data-buy="${l.id}">${t("buy_now")}</button>${marketplaceCanOneTap ? `<button class="btn btn-full" data-buyonetap="${l.id}" style="margin-top:8px;">One-tap checkout</button>` : ""}`
            : ""
        }
        <button type="button" class="btn-share" data-share="${l.id}" aria-label="${t("share")}">${t("share")}</button>
      </article>`
    )
    .join("");

  grid.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", () => buyListing(btn.dataset.buy, btn));
  });
  grid.querySelectorAll("[data-buyonetap]").forEach((btn) => {
    btn.addEventListener("click", () => buyListingOneTap(btn.dataset.buyonetap, btn));
  });
  grid.querySelectorAll("[data-intent]").forEach((btn) => {
    btn.addEventListener("click", () => confirmBuyIntent(btn.dataset.intent));
  });
  grid.querySelectorAll("[data-share]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const l = marketplaceListings.find((x) => String(x.id) === String(btn.dataset.share));
      if (l) shareListing(l);
    });
  });

  if (totalPages > 1) {
    pager.style.display = "flex";
    pager.innerHTML = "";
    const mkBtn = (label, target, opts = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (opts.active) b.classList.add("active");
      if (opts.disabled) b.disabled = true;
      b.addEventListener("click", () => {
        if (b.disabled) return;
        marketplacePage = target;
        renderListings(query, target);
        const gridTop = $("#listingsGrid");
        if (gridTop) window.scrollTo({ top: gridTop.offsetTop - 90, behavior: "smooth" });
      });
      pager.appendChild(b);
    };
    mkBtn("&lsaquo;", pg - 1, { disabled: pg === 1 });
    for (let i = 1; i <= totalPages; i++) mkBtn(i, i, { active: i === pg });
    mkBtn("&rsaquo;", pg + 1, { disabled: pg === totalPages });
  } else {
    pager.style.display = "none";
    pager.innerHTML = "";
  }
}

async function buyListing(listingId, btn) {
  if (!isLoggedIn()) {
    location.href = "/login.html?next=/marketplace.html";
    return;
  }

  let listingNotes = "";
  const notes = prompt(
    "Tell us how you'd like this website customized (e.g. add a logo, change colours, new pages, your business name).\n\nLeave empty for no customisation."
  );
  listingNotes = (notes || "").trim();

  if (btn) setLoading(btn, true, "Starting checkout...");
  try {
    const data = await api("/api/payments/initialize", { method: "POST", body: { listingId, notes: listingNotes } });
    location.href = data.authorization_url;
  } catch (err) {
    if (err.code === "DELIVERY_NOT_READY") {
      if (btn) setLoading(btn, false, t("buy_now"));
      await confirmBuyIntent(listingId);
      return;
    }
    alert(err.message);
    if (btn) setLoading(btn, false, t("buy_now"));
  }
}

async function buyListingOneTap(listingId, btn) {
  if (!isLoggedIn()) {
    location.href = "/login.html?next=/marketplace.html";
    return;
  }

  let listingNotes = "";
  const notes = prompt(
    "Tell us how you'd like this website customized (e.g. add a logo, change colours, new pages, your business name).\n\nLeave empty for no customisation."
  );
  listingNotes = (notes || "").trim();

  if (btn) setLoading(btn, true, "Charging saved card...");
  try {
    const data = await api("/api/payments/one-tap", { method: "POST", body: { listingId, notes: listingNotes } });
    location.href = `/payment-success.html?reference=${encodeURIComponent(data.reference)}`;
  } catch (err) {
    if (err.code === "DELIVERY_NOT_READY") {
      if (btn) setLoading(btn, false, "Buy Now");
      await confirmBuyIntent(listingId);
      return;
    }
    alert(err.message);
    if (btn) setLoading(btn, false, "Buy Now");
  }
}

// Buyer confirms intent on a listing that isn't ready yet (no delivery link).
async function confirmBuyIntent(listingId) {
  const ok = confirm(
    "This website is still being completed, so you can't pay for it just yet.\n\nWe'll notify you (in-app and by email) the moment it's ready to buy. No payment is taken now."
  );
  if (!ok) return;
  try {
    const data = await api("/api/payments/buy-intent", { method: "POST", body: { listingId } });
    if (data.deliveryReady) {
      // Raced - it just became ready. Jump straight into checkout.
      return buyListing(listingId);
    }
    alert("You're on the list! We'll let you know as soon as this website is ready to buy.");
    subscribeToPush();
  } catch (err) {
    alert(err.message);
  }
}

// Best-effort: register this device for web push so ready-notices arrive here too.
async function subscribeToPush() {
  if (!window.PushManager || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey, configured } = await api("/api/push/public-key");
    if (!configured || !publicKey) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const b64 = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    await api("/api/push/subscribe", {
      method: "POST",
      body: { endpoint: sub.endpoint, p256dh: b64(sub.getKey("p256dh")), auth: b64(sub.getKey("auth")) },
    });
  } catch (e) {
    console.warn("Push subscribe failed:", e.message);
  }
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

// ---- In-app notifications ----
const __notifSeen = {};

function initNotifications() {
  if (!isLoggedIn()) return;
  const poll = async () => {
    try {
      const { notifications } = await api("/api/notifications?limit=10");
      notifications.forEach((n) => {
        if (__notifSeen[n.id]) return;
        __notifSeen[n.id] = true;
        if (n.type === "listing_ready") {
          showNotifToast(n);
          api("/api/notifications/read", { method: "POST", body: { id: n.id } }).catch(() => {});
        }
      });
    } catch (e) {}
  };
  poll();
  setInterval(poll, 45000);
}

function showNotifToast(n) {
  const el = document.createElement("div");
  el.className = "notif-toast";
  el.innerHTML = `<span class="notif-toast-title">${esc(n.title)}</span><span class="notif-toast-body">${esc(n.body || "")}</span>`;
  el.addEventListener("click", () => {
    window.location.href = n.link || "/marketplace.html";
  });
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 400);
  }, 9000);
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
    const { status, order } = await api(`/api/payments/verify/${encodeURIComponent(reference)}`);
    if (status === "paid") {
      setPaymentStatus("✅", "Payment successful!", "Your order is confirmed. A receipt is ready below and a copy was emailed to you.", true);
      renderReceipt(order);
    } else if (status === "failed") {
      setPaymentStatus("❌", "Payment failed", "You can retry checkout from the marketplace.", true);
    } else {
      setTimeout(() => initPaymentSuccess(), 3000);
    }
  } catch (err) {
    setPaymentStatus("⚠️", "Could not confirm payment", err.message, true);
  }
}

function renderReceipt(order) {
  const wrap = $("#receiptWrap");
  if (!wrap || !order) return;
  $("#receiptRef").textContent = `Order ${order.reference} — paid ${new Date(order.created_at || Date.now()).toLocaleString("en-NG")}`;
  $("#receiptRows").innerHTML = `
    <tr><td>Item</td><td>${esc(order.title || "—")}</td></tr>
    <tr><td>Amount</td><td>${typeof naira === "function" ? naira(order.amount) : "₦" + (order.amount || 0)}</td></tr>
    <tr><td>Buyer</td><td>${esc(order.email || "—")}</td></tr>
    <tr><td>Status</td><td>Paid</td></tr>`;
  $("#receiptTotal").textContent = typeof naira === "function" ? naira(order.amount) : "₦" + (order.amount || 0);
  wrap.classList.remove("hidden");
  wrap.style.display = "block";
  const printBtn = $("#printBtn");
  printBtn.style.display = "";
  printBtn.addEventListener("click", () => window.print());
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
        dob: $(`#eDob`) && $(`#eDob`).value ? $(`#eDob`).value : undefined,
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
