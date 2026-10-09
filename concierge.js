// MITEX tour guide - a floating assistant that greets every visitor, knows
// which page they are on, and answers questions from conversations a guest can
// start without an account (POST /api/concierge).
//
// Deliberately dependency-free and self-contained: it injects its own DOM and
// styles, so adding it to a page is just a <script src="concierge.js" defer>
// tag. All state is sessionStorage, so a visitor gets a fresh tour each browser
// session but keeps a short history while they move between pages.

(function () {
  if (window.__mitexConciergeLoaded) return;
  window.__mitexConciergeLoaded = true;

  var SLUG = pageSlug();
  var INTRO_KEY = "mitex_concierge_intro";
  var HIST_KEY = "mitex_concierge_hist_" + SLUG;
  var MAX_TURNS = 8;

  // Client-side instant tour. The server holds the authoritative, fuller
  // wording; this just makes the first paint feel instant.
  var TOURS = {
    index:
      "Welcome to MITEX - I'm your AI tour guide. You can browse ready-made sites in the Marketplace, describe a website and have the AI Builder generate it, render a promo clip with the Video Generator, or run code in the Playground. What would you like to see first?",
    marketplace:
      "You're on the Marketplace, where ready-made websites are listed. Tell me what kind of site you're after and I'll help you find it.",
    "ai-builder":
      "You're on the AI Builder. Describe the site you want - pages, style, colours, content - and it generates the files. What are you building today?",
    "video-generator":
      "You're on the Video Generator. Describe the clip you want, pick its shape and length, and it renders a GIF to download.",
    chat:
      "You're already in the Assistant. Ask me about the AI Builder, the marketplace, the video generator, packages, hosting, or any web question.",
    "code-playground":
      "You're on the Playground - Python and C++ run right in the browser. Pick a language, type some code, and press Run. Want an example to try?",
    packages:
      "You're on Packages, where MITEX's plans are laid out. I won't quote figures, but I can explain what's included and how payments work.",
    careers:
      "You're on Careers, where open roles are listed. I don't have hiring status or timelines, but the page has the current openings.",
    account:
      "You're on your Account page - your AI projects, orders and downloads live here.",
    default:
      "Welcome to MITEX - I'm your AI tour guide. The Marketplace has ready-made websites, the AI Builder generates one from your brief, and the Video Generator makes promo clips. Where would you like to go?",
  };
  var tour = TOURS[SLUG] || TOURS.default;

  var CHIPS = ["Show me around", "What can I build?", "What does it cost?"];

  // ---- plumbing ------------------------------------------------------------

  function pageSlug() {
    var p = (location.pathname || "").replace(/^\//, "").replace(/\.html$/, "").split("/")[0];
    if (!p) p = "index";
    return p;
  }

  function history() {
    try {
      var h = JSON.parse(sessionStorage.getItem(HIST_KEY) || "[]");
      return Array.isArray(h) ? h.slice(-MAX_TURNS) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(h) {
    try {
      sessionStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-MAX_TURNS)));
    } catch (e) {}
  }

  function addTurn(h, role, content) {
    h.push({ role: role, content: content });
    return h.slice(-MAX_TURNS);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  // ---- widget chrome -------------------------------------------------------

  var STYLE_ID = "mitex-concierge-style";
  var CSS = [
    "#mitexConcierge *{box-sizing:border-box;font-family:'Inter','Sora',system-ui,sans-serif}",
    "#mitexConcierge{position:fixed;right:1rem;bottom:1rem;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:.6rem;font-size:14px;line-height:1.5;color:#e2e8f0}",
    "#mitexConcierge .wg-bubble{max-width:min(320px,calc(100vw - 2rem));background:rgba(15,23,42,.96);border:1px solid rgba(255,255,255,.12);border-radius:1rem;padding:.8rem 1rem;box-shadow:0 10px 40px rgba(0,0,0,.45);animation:wgPop .25s ease-out}",
    "@keyframes wgPop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}",
    "#mitexConcierge .wg-panel{width:min(360px,calc(100vw - 1.5rem));background:rgba(15,23,42,.98);border:1px solid rgba(255,255,255,.14);border-radius:1.1rem;box-shadow:0 20px 60px rgba(0,0,0,.55);overflow:hidden;display:none;flex-direction:column;max-height:min(620px,calc(100vh - 120px))}",
    "#mitexConcierge .wg-panel.open{display:flex;animation:wgPop .22s ease-out}",
    "#mitexConcierge .wg-head{display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#0f172a}",
    "#mitexConcierge .wg-head b{font-size:15px;letter-spacing:.2px}",
    "#mitexConcierge .wg-head span{font-size:12px;opacity:.75;margin-left:auto}",
    "#mitexConcierge .wg-close{margin-left:.5rem;background:rgba(15,23,42,.1);border:0;border-radius:.5rem;color:#0f172a;font:inherit;font-weight:800;cursor:pointer;width:26px;height:26px;line-height:1}",
    "#mitexConcierge .wg-body{display:flex;flex-direction:column;gap:.6rem;padding:.9rem;overflow-y:auto;min-height:120px;max-height:340px}",
    "#mitexConcierge .wg-msg{max-width:88%;padding:.6rem .8rem;border-radius:.9rem;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid rgba(255,255,255,.06)}",
    "#mitexConcierge .wg-msg.ai{align-self:flex-start;background:rgba(255,255,255,.06)}",
    "#mitexConcierge .wg-msg.me{align-self:flex-end;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#0f172a;font-weight:500;border:0}",
    "#mitexConcierge .wg-msg.pending{color:#94a3b8;font-style:italic}",
    "#mitexConcierge .wg-chips{display:flex;gap:.4rem;flex-wrap:wrap;padding:0 .9rem .5rem}",
    "#mitexConcierge .wg-chip{padding:.3rem .7rem;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#e2e8f0;cursor:pointer;font-size:12.5px}",
    "#mitexConcierge .wg-chip:hover{background:rgba(255,255,255,.12)}",
    "#mitexConcierge .wg-composer{display:flex;gap:.5rem;align-items:flex-end;padding:.8rem;border-top:1px solid rgba(255,255,255,.08)}",
    "#mitexConcierge .wg-composer textarea{flex:1;min-height:44px;max-height:110px;padding:.6rem .7rem;border-radius:.7rem;border:1px solid rgba(255,255,255,.14);background:rgba(15,23,42,.6);color:#e2e8f0;font:inherit;resize:vertical}",
    "#mitexConcierge .wg-composer textarea:focus{outline:2px solid #fbbf24;outline-offset:1px}",
    "#mitexConcierge .wg-send{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#0f172a;border:0;border-radius:.7rem;font:inherit;font-weight:700;padding:.6rem .9rem;cursor:pointer}",
    "#mitexConcierge .wg-send:disabled{opacity:.55;cursor:not-allowed}",
    "#mitexConcierge .wg-fab{width:56px;height:56px;border-radius:50%;border:0;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#0f172a;font-size:22px;cursor:pointer;box-shadow:0 8px 28px rgba(251,191,36,.4);display:flex;align-items:center;justify-content:center}",
    "#mitexConcierge .wg-fab[aria-expanded='true']{box-shadow:0 8px 28px rgba(15,23,42,.5)}",
    "#mitexConcierge .wg-fab:hover{transform:translateY(-2px)}",
    "#mitexConcierge .wg-note{padding:0 .9rem .6rem;font-size:11.5px;color:#94a3b8}",
    "@media (max-width:480px){#mitexConcierge{right:.6rem;bottom:.6rem} #mitexConcierge .wg-fab{width:52px;height:52px}}",
  ].join("\n");

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = el("style", { id: STYLE_ID });
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var root = el("div", { id: "mitexConcierge" });

  var bubble = el("div", { class: "wg-bubble", role: "status", "aria-live": "polite" });
  bubble.textContent = tour;
  bubble.hidden = true;

  var panel = el("div", { class: "wg-panel", role: "dialog", "aria-modal": "false", "aria-label": "MITEX AI tour guide" });
  var head = el("div", { class: "wg-head" });
  head.appendChild(el("b", { text: "MITEX AI" }));
  var status = el("span", { text: "" });
  head.appendChild(status);
  var closeBtn = el("button", { class: "wg-close", text: "\u00d7", "aria-label": "Close assistant" });
  head.appendChild(closeBtn);

  var body = el("div", { class: "wg-body", role: "log", "aria-live": "polite", "aria-label": "Conversation with MITEX AI" });
  var chipsWrap = el("div", { class: "wg-chips" });
  var form = el("form", { class: "wg-composer" });
  var input = el("textarea", { placeholder: "Ask anything...", rows: "1", "aria-label": "Your message to MITEX AI" });
  var send = el("button", { class: "wg-send", type: "submit", text: "Send" });
  form.appendChild(input);
  form.appendChild(send);

  var note = el("p", { class: "wg-note" });
  note.textContent =
    "Tours every page, answers without an account. MITEX prices and timelines are never guessed.";

  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(chipsWrap);
  panel.appendChild(form);
  panel.appendChild(note);

  var fab = el("button", {
    class: "wg-fab",
    "aria-label": "Open MITEX AI assistant",
    "aria-expanded": "false",
  });
  fab.textContent = "AI";
  fab.title = "Ask MITEX AI";

  root.appendChild(bubble);
  root.appendChild(panel);
  root.appendChild(fab);

  function hideBubble() {
    bubble.hidden = true;
    sessionStorage.setItem(INTRO_KEY, "1");
  }

  function openPanel() {
    panel.classList.add("open");
    fab.setAttribute("aria-expanded", "true");
    hideBubble();
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch (e) {}
    renderThread();
    input.focus();
  }

  function closePanel() {
    panel.classList.remove("open");
    fab.setAttribute("aria-expanded", "false");
  }

  fab.addEventListener("click", function () {
    if (panel.classList.contains("open")) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener("click", closePanel);

  function renderThread() {
    body.textContent = "";
    var stored = history();
    if (!stored.length) {
      body.appendChild(aiMsg(tour));
    } else {
      stored.forEach(function (m) {
        body.appendChild(m.role === "user" ? meMsg(m.content) : aiMsg(m.content));
      });
    }
  }

  function aiMsg(text) {
    var n = el("div", { class: "wg-msg ai" });
    n.textContent = text;
    return n;
  }
  function meMsg(text) {
    var n = el("div", { class: "wg-msg me" });
    n.textContent = text;
    return n;
  }

  function renderChips() {
    chipsWrap.textContent = "";
    CHIPS.forEach(function (label) {
      var c = el("button", { class: "wg-chip", type: "button", text: label });
      c.addEventListener("click", function () {
        var t = label;
        var h = history();
        h = addTurn(h, "user", t);
        saveHistory(h);
        body.appendChild(meMsg(t));
        askReply(h);
      });
      chipsWrap.appendChild(c);
    });
  }

  function setBusy(on) {
    send.disabled = on;
    input.disabled = on;
    send.textContent = on ? "..." : "Send";
  }

  function askReply(h) {
    var pending = el("div", { class: "wg-msg ai pending", text: "Thinking..." });
    body.appendChild(pending);
    body.scrollTop = body.scrollHeight;
    setBusy(true);
    fetch("/api/concierge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: h, page: SLUG }),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { error: "The assistant is unavailable right now." };
        });
      })
      .then(function (res) {
        pending.remove();
        if (res && res.ok && res.reply) {
          var text = res.reply;
          h = addTurn(h, "assistant", text);
          saveHistory(h);
          body.appendChild(aiMsg(text));
        } else {
          body.appendChild(
            aiMsg("I could not answer that right now. Try me again in a moment.")
          );
        }
        body.scrollTop = body.scrollHeight;
        setBusy(false);
      })
      .catch(function () {
        pending.remove();
        body.appendChild(aiMsg("The assistant is unreachable right now. Please try again."));
        body.scrollTop = body.scrollHeight;
        setBusy(false);
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = "";
    input.style.height = "auto";
    var h = history();
    h = addTurn(h, "user", text);
    saveHistory(h);
    body.appendChild(meMsg(text));
    askReply(h);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  });

  // Resize the composer height, keep the panel's quick chips out of the way.
  renderChips();

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
  });

  // Auto-welcome: show the touring bubble once per browser session, then leave
  // the user alone until they click.
  ensureStyles();
  document.body.appendChild(root);
  var greeted = false;
  try {
    greeted = sessionStorage.getItem(INTRO_KEY) === "1";
  } catch (e) {}
  if (!greeted) {
    setTimeout(function () {
      if (panel.classList.contains("open")) return;
      bubble.hidden = false;
      // Dismiss after a while, and on any interaction so it never nags.
      setTimeout(hideBubble, 14000);
      var dismiss = function () {
        hideBubble();
        window.removeEventListener("scroll", dismiss);
        document.removeEventListener("click", dismiss);
      };
      window.addEventListener("scroll", dismiss, { passive: true });
      setTimeout(function () {
        document.addEventListener("click", dismiss);
      }, 400);
      // The Close chip inside reads as text here; make the whole bubble tappable
      // only via its button to stay accessible.
    }, 1500);
  }
})();