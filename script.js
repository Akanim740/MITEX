const hamburger = document.getElementById("hamburger");
const navLinks = document.getElementById("navLinks");
const navbar = document.getElementById("navbar");

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

(function initNavAuth() {
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("mitex_user"));
  } catch {}

  if (!localStorage.getItem("mitex_token") || !user) return;

  const initial = (user.name || "?").charAt(0).toUpperCase();
  const isStaff = user.role === "admin" || user.role === "editor";

  const navAuth = document.querySelector(".nav-auth");
  navAuth.innerHTML = `
    <div class="nav-user" id="navUser">
      <button type="button" class="nav-user-btn" id="navUserBtn" aria-expanded="false">
        <span class="nav-avatar">${escHtml(initial)}</span>
        ${escHtml((user.name || "Account").split(" ")[0])}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="nav-menu">
        <a href="/account.html">My Account</a>
        <a href="/account.html#orders-panel">My Orders</a>
        <a href="/marketplace.html">Marketplace</a>
        ${isStaff ? '<a href="/dashboard.html">Admin dashboard</a>' : ""}
        <button type="button" class="danger" id="navLogout">Log out</button>
      </div>
    </div>`;

  document.getElementById("mobileSignIn").innerHTML = '<a href="/account.html">My Account</a>';
  document.getElementById("mobileCreate").innerHTML = '<a href="/marketplace.html">Marketplace</a>';

  const wrap = document.getElementById("navUser");
  const btn = document.getElementById("navUserBtn");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = wrap.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => wrap.classList.remove("open"));
  document.addEventListener("keydown", (e) => e.key === "Escape" && wrap.classList.remove("open"));

  document.getElementById("navLogout").addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    localStorage.removeItem("mitex_token");
    localStorage.removeItem("mitex_user");
    location.reload();
  });
})();

hamburger.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  hamburger.classList.toggle("active", isOpen);
  hamburger.setAttribute("aria-expanded", String(isOpen));
});

navLinks.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    hamburger.classList.remove("active");
    hamburger.setAttribute("aria-expanded", "false");
  });
});

window.addEventListener("scroll", () => {
  navbar.classList.toggle("scrolled", window.scrollY > 20);
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

const counterObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.5 }
);

document.querySelectorAll(".stat-number").forEach((el) => counterObserver.observe(el));

function animateCounter(el) {
  const target = Number(el.dataset.count) || 0;
  const suffix = el.dataset.suffix || "";
  const duration = 1600;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

const sections = document.querySelectorAll("main section[id]");
const navAnchors = document.querySelectorAll(".nav-links a");

const activeObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navAnchors.forEach((a) => {
        a.classList.toggle("active", a.getAttribute("href") === "#" + entry.target.id);
      });
    });
  },
  { rootMargin: "-40% 0px -55% 0px" }
);

sections.forEach((s) => activeObserver.observe(s));

const enquiryForm = document.getElementById("enquiryForm");
const whatsappNumber = "2347011633770";
const formNote = enquiryForm.querySelector(".form-note");

function setFormState(button, disabled, label) {
  button.disabled = disabled;
  button.textContent = label;
}

enquiryForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("senderName").value.trim();
  const message = document.getElementById("senderMessage").value.trim();
  const submitBtn = enquiryForm.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;

  setFormState(submitBtn, true, "Sending...");

  try {
    const res = await fetch("/api/enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message, intent: "buy" }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data.error || "Request failed");

    enquiryForm.reset();
    formNote.textContent = "Enquiry received. The MITEX team will contact you shortly.";
    formNote.style.color = "#25d366";
  } catch (err) {
    const text = encodeURIComponent(`Hello MITEX! My name is ${name}. ${message}`);
    window.open(`https://wa.me/${whatsappNumber}?text=${text}`, "_blank", "noopener");
    formNote.textContent = "Could not reach the server - opening WhatsApp instead.";
    formNote.style.color = "#fbbf24";
  } finally {
    setFormState(submitBtn, false, originalLabel);
  }
});

const sellForm = document.getElementById("sellForm");

if (sellForm) {
  const sellError = document.getElementById("sellError");
  const sellNote = sellForm.querySelector(".form-note");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  sellForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const platform = document.getElementById("sellPlatform").value;
    const payment = document.getElementById("sellPayment").value;
    const name = document.getElementById("sellerName").value.trim();
    const contact = document.getElementById("sellerContact").value.trim();
    const submitBtn = sellForm.querySelector("button[type=submit]");
    const originalLabel = submitBtn.textContent;

    sellError.classList.add("hidden");
    if (!platform || !payment) {
      sellError.textContent = "Please choose a platform and a payout method.";
      sellError.classList.remove("hidden");
      return;
    }
    if (!EMAIL_RE.test(contact)) {
      sellError.textContent = "Please enter a valid email address so we can reach you.";
      sellError.classList.remove("hidden");
      return;
    }

    setFormState(submitBtn, true, "Sending...");
    const summary = `I want to sell my premium website. Preferred platform: ${platform}. Payout method: ${payment}. Contact: ${contact}`;
    const waText = encodeURIComponent(`Hello MITEX! My name is ${name}. ${summary}`);

    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: contact, message: summary, intent: "sell" }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");

      window.open(`https://wa.me/${whatsappNumber}?text=${waText}`, "_blank", "noopener");
      sellForm.reset();
      sellNote.textContent = "Sale request received. We will send your valuation within 24 hours.";
      sellNote.style.color = "#25d366";
    } catch (err) {
      window.open(`https://wa.me/${whatsappNumber}?text=${waText}`, "_blank", "noopener");
      sellNote.textContent = "Could not reach the server - opening WhatsApp instead.";
      sellNote.style.color = "#fbbf24";
    } finally {
      setFormState(submitBtn, false, originalLabel);
    }
  });
}

document.getElementById("year").textContent = new Date().getFullYear();

/* ===== Welcome gate ===== */
(function initWelcomeGate() {
  const gate = document.getElementById("welcomeGate");
  if (!gate) return;

  // Signed-in team members and returning visitors skip the gate
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("mitex_user"));
  } catch {}
  const isTeam = user && (user.role === "admin" || user.role === "editor" || user.role === "staff");
  if (isTeam || localStorage.getItem("mitex_audience")) return;

  gate.classList.remove("hidden");
  gate.setAttribute("aria-hidden", "false");

  function closeGate(choice) {
    if (choice) localStorage.setItem("mitex_audience", choice);
    gate.classList.add("hidden");
    gate.setAttribute("aria-hidden", "true");
  }

  gate.querySelectorAll("[data-gate-choice]").forEach((link) => {
    link.addEventListener("click", () => closeGate(link.dataset.gateChoice));
  });

  document.getElementById("gateSkip").addEventListener("click", () => closeGate("customer"));

  gate.addEventListener("click", (e) => {
    if (e.target === gate) closeGate("customer");
  });
})();
