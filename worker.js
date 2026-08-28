const $ = (sel) => document.querySelector(sel);
let currentUser = null;

const API = {
  async request(path, options = {}, retried = false) {
    const token = localStorage.getItem("mitex_token");
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      ...(options.body ? { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) } : {}),
    });
    if (res.status === 401 && !retried && !path.startsWith("/api/auth/")) {
      const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
      if (refreshed.ok) {
        const data = await refreshed.json();
        localStorage.setItem("mitex_token", data.accessToken);
        return this.request(path, options, true);
      }
      localStorage.removeItem("mitex_token");
      localStorage.removeItem("mitex_user");
      location.href = "/login.html";
      throw new Error("Session expired. Please sign in again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },
  get: (path) => API.request(path),
  post: (path, body) => API.request(path, { method: "POST", body }),
  put: (path, body) => API.request(path, { method: "PUT", body }),
};

function esc(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function logout(hard) {
  localStorage.removeItem("mitex_token");
  localStorage.removeItem("mitex_user");
  if (hard) location.href = "/login.html";
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}

function showApp(user) {
  currentUser = user;
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#userAvatar").textContent = (user.name || "W").charAt(0).toUpperCase();
  $("#userEmailLabel").textContent = user.email;
  $("#userNameLabel").textContent = user.name;
  $("#welcomeName").textContent = `Welcome, ${user.name.split(" ")[0]}`;
  $("#welcomeSub").textContent = user.role === "staff" ? "Here's your work overview." : "Work dashboard";
  $("#profileAvatar").textContent = (user.name || "W").charAt(0).toUpperCase();
  $("#profileName").textContent = user.name;
  $("#profileEmail").textContent = user.email;
  $("#profileRole").textContent = user.role;
  $("#profilePhone").textContent = user.phone || "No phone set";

  const verEl = $("#verificationBody");
  if (verEl) {
    if (user.verified_id) {
      verEl.innerHTML = `
        <p class="empty-state">✓ Your ID is verified.</p>
        <p class="muted" style="font-size:.85rem;">Your NIN/BVN is stored encrypted and is only visible to the MITEX admin.</p>
      `;
    } else {
      verEl.innerHTML = `
        <p class="muted" style="margin-bottom:16px;">You haven't submitted your 11-digit NIN/BVN yet. MITEX requires every worker to be verified.</p>
        <div class="project-actions">
          <input type="text" id="workerNin" maxlength="11" placeholder="11-digit NIN or BVN" class="project-url" style="flex:1;min-width:200px;" />
          <button class="btn btn-primary btn-sm" id="workerNinBtn">Submit verification</button>
        </div>
        <p class="muted" id="workerNinMsg" style="font-size:.85rem;"></p>
        <p class="muted" style="font-size:.82rem;margin-top:6px;">Upload a photo of your ID is optional but speeds up verification. You can submit the photo after entering your number.</p>
      `;
      const btn = $("#workerNinBtn");
      const msg = $("#workerNinMsg");
      btn.addEventListener("click", async () => {
        const value = $("#workerNin").value.trim();
        if (!/^\d{11}$/.test(value)) {
          msg.textContent = "NIN/BVN must be exactly 11 digits.";
          return;
        }
        btn.disabled = true;
        btn.textContent = "Submitting...";
        try {
          await API.put("/api/users/me", { ninBvn: value });
          msg.textContent = "Saved. Your admin has been notified.";
          const me = await API.get("/api/auth/me");
          currentUser = me;
          verEl.innerHTML = `<p class="empty-state">✓ Your ID is verified.</p>`;
        } catch (err) {
          msg.textContent = err.message;
        } finally {
          btn.disabled = false;
          btn.textContent = "Submit verification";
        }
      });
    }
  }
}

async function initAuth() {
  const token = localStorage.getItem("mitex_token");
  if (!token) return showLogin();
  try {
    const user = await API.get("/api/auth/me");
    localStorage.setItem("mitex_user", JSON.stringify(user));
    showApp(user);
    loadProjects();
    loadNotifications();
  } catch {
    showLogin();
  }
}

async function loadProjects() {
  const body = $("#projectsBody");
  body.innerHTML = '<p class="empty-state">Loading your assignments...</p>';
  try {
    const rows = await API.get("/api/listings/mine");
    if (!rows.length) {
      body.innerHTML = '<p class="empty-state">No projects assigned to you yet.</p>';
      return;
    }
    body.innerHTML = rows.map((r) => `
      <div class="project-card">
        <div class="project-head">
          <strong>${esc(r.title)}</strong>
          <span class="status-chip status-${esc(r.status)}">${esc(r.status)}</span>
        </div>
        <span class="project-label">Delivery URL (where buyers download their work)</span>
        <input type="url" class="project-url" data-purl="${r.id}" placeholder="https://your-site.netlify.app" value="${esc(r.delivery_url || "")}" />
        <div class="project-actions">
          <button class="btn btn-primary btn-sm" data-psave="${r.id}">Save Delivery Link</button>
          <span class="project-msg${r.delivery_url ? " saved" : ""}" data-pmsg="${r.id}">${r.delivery_url ? "Saved — buyers can download" : "Not yet submitted"}</span>
        </div>
      </div>
    `).join("");

    body.querySelectorAll("[data-psave]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.psave;
        const url = body.querySelector(`[data-purl="${id}"]`).value.trim();
        if (!url) return alert("Paste the live URL of your finished work first.");
        if (!/^https?:\/\//i.test(url)) return alert("URL must start with http:// or https://");
        btn.disabled = true;
        btn.textContent = "Saving...";
        try {
          await API.put(`/api/listings/${id}`, { deliveryUrl: url });
          const msg = body.querySelector(`[data-pmsg="${id}"]`);
          msg.textContent = "Saved — buyers can download";
          msg.classList.add("saved");
        } catch (err) {
          alert(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = "Save Delivery Link";
        }
      })
    );
  } catch (err) {
    body.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
  }
}

async function loadNotifications() {
  const notifList = $("#notifList");
  const badge = $("#notifBadge");
  try {
    const [salaries, listings] = await Promise.all([
      API.get("/api/salaries/mine").catch(() => []),
      API.get("/api/listings/mine").catch(() => []),
    ]);
    const items = [];
    (salaries || []).forEach((s) => {
      items.push({
        type: "salary",
        text: `Salary recorded: ${s.period} — ₦${Number(s.amount).toLocaleString("en-NG")}${s.bonus ? ` + ₦${Number(s.bonus).toLocaleString("en-NG")} bonus` : ""}`,
        date: s.paid_at,
      });
    });
    (listings || []).forEach((l) => {
      if (!l.delivery_url) {
        items.push({ type: "project", text: `New project assigned: ${l.title}`, date: l.created_at });
      }
    });
    items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!items.length) {
      notifList.innerHTML = '<li class="empty-state">No notifications yet.</li>';
      badge.classList.add("hidden");
      return;
    }
    badge.textContent = items.length;
    badge.classList.remove("hidden");
    notifList.innerHTML = items.map((n) => `
      <li>
        <span class="notif-type ${n.type}">${n.type}</span>
        ${esc(n.text)}
        <span class="notif-date">${fmtDate(n.date)}</span>
      </li>
    `).join("");
  } catch {
    notifList.innerHTML = '<li class="empty-state">No notifications yet.</li>';
  }
}

/* ─── Login ─── */
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#loginError");
  errEl.classList.add("hidden");
  const btn = $("#loginBtn");
  btn.disabled = true;
  btn.textContent = "Signing in...";
  try {
    const data = await API.post("/api/auth/login", {
      email: $("#loginEmail").value.trim(),
      password: $("#loginPassword").value,
    });
    localStorage.setItem("mitex_token", data.accessToken);
    localStorage.setItem("mitex_user", JSON.stringify(data.user));
    showApp(data.user);
    loadProjects();
    loadNotifications();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});

/* ─── Dropdown ─── */
document.querySelectorAll("[data-dropdown] .drop-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = btn.closest("[data-dropdown]");
    document.querySelectorAll("[data-dropdown].open").forEach((d) => { if (d !== dd) d.classList.remove("open"); });
    dd.classList.toggle("open");
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll("[data-dropdown].open").forEach((d) => d.classList.remove("open"));
});

/* ─── Notification drawer ─── */
$("#notifBtn").addEventListener("click", () => {
  const overlay = $("#notifOverlay");
  const drawer = $("#notifDrawer");
  const drawerList = $("#notifDrawerList");
  overlay.classList.remove("hidden");
  drawer.classList.remove("hidden");
  drawerList.innerHTML = $("#notifList").innerHTML;
});
$("#notifClose").addEventListener("click", () => {
  $("#notifOverlay").classList.add("hidden");
  $("#notifDrawer").classList.add("hidden");
});
$("#notifOverlay").addEventListener("click", () => {
  $("#notifOverlay").classList.add("hidden");
  $("#notifDrawer").classList.add("hidden");
});

/* ─── Logout ─── */
$("#logoutBtn").addEventListener("click", () => {
  logout(true);
});

/* ─── New-API notification polling (buyer_waiting toasts) ─── */
const __wnotifSeen = {};
function initWorkerNotifPoll() {
  if (!localStorage.getItem("mitex_token")) return;
  const poll = async () => {
    try {
      const data = await API.get("/api/notifications?limit=10");
      const notifications = data.notifications || [];
      const badge = $("#notifBadge");
      if (data.unread > 0) {
        badge.textContent = String(data.unread);
        badge.classList.remove("hidden");
      }
      let revealed = false;
      notifications.forEach((n) => {
        if (__wnotifSeen[n.id]) return;
        __wnotifSeen[n.id] = true;
        if (n.type === "buyer_waiting") {
          revealed = true;
          workerNotifToast(n);
          API.post("/api/notifications/read", { id: n.id }).catch(() => {});
        }
      });
      if (revealed) loadNotifications().catch(() => {});
    } catch (e) {}
  };
  poll();
  setInterval(poll, 30000);
}

function workerNotifToast(n) {
  const el = document.createElement("div");
  el.className = "wnotif-toast";
  el.innerHTML = `<strong>${esc(n.title)}</strong><div>${esc(n.body || "")}</div>`;
  el.addEventListener("click", () => {
    window.location.href = n.link || "/worker.html";
  });
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 400);
  }, 9000);
}

initWorkerNotifPoll();

initAuth();
