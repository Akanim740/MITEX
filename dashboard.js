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
    });

    if (res.status === 401 && !retried && !path.startsWith("/api/auth/")) {
      const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
      if (refreshed.ok) {
        const data = await refreshed.json();
        localStorage.setItem("mitex_token", data.accessToken);
        return this.request(path, options, true);
      }
      logout(true);
      showLogin();
      throw new Error("Session expired. Please sign in again.");
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },
  get(path) {
    return this.request(path);
  },
  post(path, body) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  },
  patch(path, body) {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  },
  put(path, body) {
    return this.request(path, { method: "PUT", body: JSON.stringify(body) });
  },
  del(path) {
    return this.request(path, { method: "DELETE" });
  },
};

const $ = (sel) => document.querySelector(sel);

function esc(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function naira(value) {
  return "\u20A6" + Number(value).toLocaleString("en-NG");
}

function fmtDate(iso) {
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function logout(silent) {
  localStorage.removeItem("mitex_token");
  localStorage.removeItem("mitex_user");
  if (!silent) location.reload();
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  $("#deniedView").classList.add("hidden");
}

function showDenied() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.add("hidden");
  $("#deniedView").classList.remove("hidden");
}

let currentUser = null;

function showApp(user) {
  if (!["admin", "editor", "staff"].includes(user.role)) {
    logout(true);
    return showDenied();
  }
  currentUser = user;
  $("#loginView").classList.add("hidden");
  $("#deniedView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#userNameLabel").textContent = (user.name || "Admin").split(" ")[0];
  $("#userAvatar").textContent = (user.name || "A").charAt(0).toUpperCase();
  $("#userEmailLabel").textContent = user.email;
  $("#userRoleLabel").textContent = user.role;

  const staffUser = user.role === "staff";
  document.querySelectorAll("[data-admin-only]").forEach((el) => el.classList.toggle("hidden", staffUser));
}

async function initAuth() {
  const token = localStorage.getItem("mitex_token");
  if (!token) return showLogin();
  try {
    const user = await API.get("/api/auth/me");
    localStorage.setItem("mitex_user", JSON.stringify(user));
    showApp(user);
    setView(user.role === "staff" ? "listings" : "overview");
  } catch {
    showLogin();
  }
}

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
    setView(data.user.role === "staff" ? "listings" : "overview");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});

$("#logoutBtn").addEventListener("click", () => logout(false));
$("#deniedLogoutBtn").addEventListener("click", () => logout(false));
$("#viewSiteBtn").addEventListener("click", () => (location.href = "/index.html"));
$("#viewMarketBtn").addEventListener("click", () => (location.href = "/marketplace.html"));

document.querySelectorAll("[data-dropdown] .drop-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = btn.closest("[data-dropdown]");
    document.querySelectorAll("[data-dropdown].open").forEach((other) => {
      if (other !== dd) {
        other.classList.remove("open");
        other.querySelector(".drop-btn").setAttribute("aria-expanded", "false");
      }
    });
    const open = dd.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
  });
});

document.addEventListener("click", () => {
  document.querySelectorAll("[data-dropdown].open").forEach((dd) => {
    dd.classList.remove("open");
    dd.querySelector(".drop-btn").setAttribute("aria-expanded", "false");
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll("[data-dropdown].open").forEach((dd) => dd.classList.remove("open"));
  }
});

const loaders = {
  overview: loadOverview,
  enquiries: loadEnquiries,
  listings: loadListings,
  orders: loadOrders,
  subscribers: loadSubscribers,
  employees: loadEmployees,
};

let currentView = null;

function setView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const target = $(`#view-${name}`);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll(".topnav .navlink[data-view], .drop-menu button[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name && !b.closest(".drop-menu"));
  });

  document.querySelectorAll("[data-dropdown].open").forEach((dd) => dd.classList.remove("open"));

  if (loaders[name]) loaders[name]();
}

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

$("#refreshEnquiries").addEventListener("click", loadEnquiries);
$("#refreshListings").addEventListener("click", loadListings);
$("#refreshOrders").addEventListener("click", loadOrders);
$("#refreshSubs").addEventListener("click", loadSubscribers);
$("#refreshEmployees").addEventListener("click", loadEmployees);

async function loadOverview() {
  const grid = $("#statsGrid");
  grid.innerHTML = '<p class="empty-state">Loading stats...</p>';
  try {
    const s = await API.get("/api/auth/dashboard");
    const cards = [
      { num: naira(s.orders.revenue), lbl: "Revenue" },
      { num: s.orders.paid, lbl: "Paid Orders" },
      { num: s.enquiries.new, lbl: "New Enquiries" },
      { num: s.enquiries.total, lbl: "Total Enquiries" },
      { num: s.listings.available, lbl: "Available Listings" },
      { num: s.listings.sold, lbl: "Sold Listings" },
      { num: naira(s.listings.inventoryValue), lbl: "Inventory Value" },
      { num: s.subscribers, lbl: "Subscribers" },
    ];
    grid.innerHTML = cards
      .map((c) => `<div class="stat-card"><span class="num">${esc(c.num)}</span><span class="lbl">${esc(c.lbl)}</span></div>`)
      .join("");
  } catch (err) {
    grid.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
  }
}

async function loadEnquiries() {
  const body = $("#enquiriesBody");
  body.innerHTML = '<tr><td colspan="8" class="empty-state">Loading...</td></tr>';
  try {
    const rows = await API.get("/api/enquiries");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty-state">No enquiries yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td>${esc(r.name)}</td>
          <td>${esc(r.email)}${r.phone ? `<br /><span class="muted">${esc(r.phone)}</span>` : ""}</td>
          <td>${r.intent ? `<span class="badge ${esc(r.intent)}">${esc(r.intent)}</span>` : '<span class="muted">-</span>'}</td>
          <td>${r.level ?? "-"}</td>
          <td class="msg-cell" title="${esc(r.message)}">${esc(r.message)}</td>
          <td>
            <select class="status-select" data-id="${r.id}">
              ${["new", "contacted", "closed"].map((s) => `<option value="${s}" ${r.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </td>
          <td class="muted">${fmtDate(r.created_at)}</td>
          <td><div class="row-actions"><button class="icon-btn delete" data-del="${r.id}">Delete</button></div></td>
        </tr>`
      )
      .join("");

    body.querySelectorAll(".status-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try {
          await API.patch(`/api/enquiries/${sel.dataset.id}/status`, { status: sel.value });
        } catch (err) {
          alert(err.message);
          loadEnquiries();
        }
      });
    });

    body.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this enquiry?")) return;
        try {
          await API.del(`/api/enquiries/${btn.dataset.del}`);
          loadEnquiries();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">${esc(err.message)}</td></tr>`;
  }
}

const listingForm = $("#listingForm");
let staffCache = [];

async function refreshEmployeeSelect(selectedId) {
  const sel = $("#fEmployee");
  if (!sel || !currentUser || currentUser.role === "staff") return;
  try {
    staffCache = await API.get("/api/auth/staff");
    sel.innerHTML =
      '<option value="">Unassigned (admin handles)</option>' +
      staffCache
        .filter((s) => Number(s.active))
        .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.listingCount ? ` (${s.listingCount})` : ""}</option>`)
        .join("");
    if (selectedId !== undefined) sel.value = selectedId ?? "";
  } catch {}
}

listingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    title: $("#fTitle").value.trim(),
    description: $("#fDesc").value.trim(),
    price: Number($("#fPrice").value),
    level: $("#fLevel").value ? Number($("#fLevel").value) : null,
    tech_stack: $("#fTech").value.trim(),
    status: $("#fStatus").value,
    deliveryUrl: $("#fDelivery") ? $("#fDelivery").value.trim() : "",
  };
  if (currentUser && currentUser.role !== "staff") {
    payload.employeeId = $("#fEmployee") && $("#fEmployee").value ? $("#fEmployee").value : null;
  }
  const id = $("#listingId").value;
  if (!id && currentUser && currentUser.role === "staff") {
    alert("Employees edit existing listings. Ask an admin to assign one to you.");
    return;
  }
  try {
    if (id) {
      await API.put(`/api/listings/${id}`, payload);
    } else {
      await API.post("/api/listings", payload);
    }
    resetListingForm();
    loadListings();
  } catch (err) {
    alert(err.message);
  }
});

$("#cancelEdit").addEventListener("click", resetListingForm);

function resetListingForm() {
  listingForm.reset();
  $("#listingId").value = "";
  $("#listingSubmit").textContent = "Add Listing";
  $("#cancelEdit").classList.add("hidden");
  if (currentUser && currentUser.role === "staff") {
    $("#listingSubmit").classList.add("hidden");
  } else if ($("#fEmployee")) {
    $("#fEmployee").value = "";
    $("#listingSubmit").classList.remove("hidden");
  }
}

async function loadListings() {
  const body = $("#listingsBody");
  const staffUser = currentUser && currentUser.role === "staff";
  body.innerHTML = '<tr><td colspan="7" class="empty-state">Loading...</td></tr>';
  try {
    if (!staffUser) refreshEmployeeSelect();
    else {
      $("#listingSubmit").textContent = "Save Changes";
      $("#listingSubmit").classList.add("hidden");
    }
    const rows = await API.get(staffUser ? "/api/listings/mine" : "/api/listings?includeSold=true");
    if (!rows.length) {
      body.innerHTML = staffUser
        ? '<tr><td colspan="7" class="empty-state">No listings assigned to you yet. An admin will assign them.</td></tr>'
        : '<tr><td colspan="7" class="empty-state">No listings yet. Add your first premium website above.</td></tr>';
      return;
    }
    const empName = (id) => {
      const s = staffCache.find((x) => String(x.id) === String(id));
      return s ? s.name : null;
    };
    body.innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td><strong>${esc(r.title)}</strong><br /><span class="muted">${esc(r.tech_stack || "")}</span></td>
          <td>${naira(r.price)}</td>
          <td>${r.level ?? "-"}</td>
          <td>${!staffUser && r.employee_id ? esc(empName(r.employee_id)) || "?" : '<span class="muted">-</span>'}</td>
          <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
          <td class="muted">${fmtDate(r.created_at)}</td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" data-edit="${r.id}">Edit</button>
              ${staffUser ? "" : `<button class="icon-btn delete" data-del="${r.id}">Delete</button>`}
            </div>
          </td>
        </tr>`
      )
      .join("");

    body.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = rows.find((r) => String(r.id) === btn.dataset.edit);
        if (!row) return;
        $("#listingId").value = row.id;
        $("#fTitle").value = row.title;
        $("#fDesc").value = row.description;
        $("#fPrice").value = row.price;
        $("#fLevel").value = row.level ?? "";
        $("#fTech").value = row.tech_stack || "";
        $("#fStatus").value = row.status;
        $("#fDelivery").value = row.delivery_url || "";
        if ($("#fEmployee")) refreshEmployeeSelect(row.employee_id);
        $("#listingSubmit").classList.remove("hidden");
        $("#listingSubmit").textContent = "Save Changes";
        $("#cancelEdit").classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    body.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this listing?")) return;
        try {
          await API.del(`/api/listings/${btn.dataset.del}`);
          loadListings();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="empty-state">${esc(err.message)}</td></tr>`;
  }
}

// ---- Employees ----
const employeeForm = $("#employeeForm");

employeeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#employeeId").value;
  try {
    if (id) {
      const patch = {
        name: $("#eName").value.trim(),
        phone: $("#ePhone").value.trim(),
        title: $("#eTitle").value.trim(),
      };
      if ($("#ePassword").value) patch.newPassword = $("#ePassword").value;
      await API.patch(`/api/auth/staff/${id}`, patch);
    } else {
      await API.post("/api/auth/staff", {
        name: $("#eName").value.trim(),
        email: $("#eEmail").value.trim(),
        password: $("#ePassword").value,
        phone: $("#ePhone").value.trim(),
        title: $("#eTitle").value.trim(),
      });
    }
    resetEmployeeForm();
    loadEmployees();
    refreshEmployeeSelect();
  } catch (err) {
    alert(err.message);
  }
});

$("#cancelEmployeeEdit").addEventListener("click", resetEmployeeForm);

function resetEmployeeForm() {
  employeeForm.reset();
  $("#employeeId").value = "";
  $("#employeeSubmit").textContent = "Add Employee";
  $("#cancelEmployeeEdit").classList.add("hidden");
}

async function loadEmployees() {
  const body = $("#employeesBody");
  body.innerHTML = '<tr><td colspan="5" class="empty-state">Loading...</td></tr>';
  try {
    const rows = await API.get("/api/auth/staff");
    $("#employeeCount").textContent = `${rows.length} / 21 employees`;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No employees yet. Add your first team member above.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td><strong>${esc(r.name)}</strong>${r.title ? `<br /><span class="muted">${esc(r.title)}</span>` : ""}</td>
          <td>${esc(r.email)}${r.phone ? `<br /><span class="muted">${esc(r.phone)}</span>` : ""}</td>
          <td>${r.listingCount}</td>
          <td><span class="badge ${Number(r.active) ? "available" : "sold"}">${Number(r.active) ? "active" : "inactive"}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" data-eedit="${r.id}">Edit</button>
              <button class="icon-btn" data-etoggle="${r.id}" data-active="${Number(r.active)}">${Number(r.active) ? "Deactivate" : "Activate"}</button>
              <button class="icon-btn delete" data-edel="${r.id}">Remove</button>
            </div>
          </td>
        </tr>`
      )
      .join("");

    body.querySelectorAll("[data-eedit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const row = rows.find((r) => String(r.id) === btn.dataset.eedit);
        if (!row) return;
        $("#employeeId").value = row.id;
        $("#eName").value = row.name;
        $("#eEmail").value = row.email;
        $("#eEmail").disabled = true;
        $("#ePassword").value = "";
        $("#ePhone").value = row.phone || "";
        $("#eTitle").value = row.title || "";
        $("#employeeSubmit").textContent = "Save Changes";
        $("#cancelEmployeeEdit").classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
    );

    body.querySelectorAll("[data-etoggle]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const active = btn.dataset.active === "1";
        try {
          await API.patch(`/api/auth/staff/${btn.dataset.etoggle}`, { active: !active });
          loadEmployees();
        } catch (err) {
          alert(err.message);
        }
      })
    );

    body.querySelectorAll("[data-edel]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this employee? Their listings become unassigned.")) return;
        try {
          await API.del(`/api/auth/staff/${btn.dataset.edel}`);
          loadEmployees();
          refreshEmployeeSelect();
        } catch (err) {
          alert(err.message);
        }
      })
    );
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="empty-state">${esc(err.message)}</td></tr>`;
  }
}

async function loadOrders() {
  const body = $("#ordersBody");
  body.innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';
  try {
    const rows = await API.get("/api/payments/orders");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">No orders yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td class="muted">${esc(r.reference)}</td>
          <td><strong>${esc(r.title)}</strong></td>
          <td>${esc(r.email)}${r.name ? `<br /><span class="muted">${esc(r.name)}</span>` : ""}</td>
          <td>${naira(r.amount)}</td>
          <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
          <td class="muted">${fmtDate(r.created_at)}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="empty-state">${esc(err.message)}</td></tr>`;
  }
}

async function loadSubscribers() {
  const list = $("#subsList");
  list.innerHTML = '<li class="empty-state">Loading...</li>';
  try {
    const rows = await API.get("/api/newsletter");
    if (!rows.length) {
      list.innerHTML = '<li class="empty-state">No subscribers yet.</li>';
      return;
    }
    list.innerHTML = rows
      .map((r) => `<li>${esc(r.email)}<span>${fmtDate(r.created_at)}</span></li>`)
      .join("");
  } catch (err) {
    list.innerHTML = `<li class="empty-state">${esc(err.message)}</li>`;
  }
}

initAuth();
