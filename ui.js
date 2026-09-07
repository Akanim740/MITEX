/* MITEX UI layer: theme (dark/light), toasts, skeleton + empty/error states.
   Loaded in <head> WITHOUT defer so the theme applies before first paint. */
(function () {
  "use strict";

  var STORE = "mitex_theme";

  function currentTheme() {
    try {
      return localStorage.getItem(STORE) || "dark";
    } catch (e) {
      return "dark";
    }
  }
  function applyTheme(theme) {
    if (!theme) theme = "dark";
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORE, theme);
    } catch (e) {}
    var btn = document.getElementById("mitexThemeBtn");
    if (btn) {
      btn.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
      btn.innerHTML =
        theme === "light"
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/></svg>';
    }
  }

  applyTheme(currentTheme());

  window.MITEXTheme = {
    current: currentTheme,
    apply: applyTheme,
    toggle: function () {
      applyTheme(currentTheme() === "light" ? "dark" : "light");
    },
  };

  var COMPONENT_CSS =
    "#mitexThemeBtn{position:fixed;right:18px;bottom:18px;z-index:1200;width:44px;height:44px;border-radius:50%;border:1px solid var(--card-border,#2a3550);background:var(--card,#151c31);color:var(--gold,#fbbf24);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:transform .25s ease, background .25s ease, color .25s ease;}" +
    "#mitexThemeBtn:hover{transform:translateY(-2px) rotate(12deg);}" +
    "@media (min-width:1024px){#mitexThemeBtn{right:26px;bottom:26px;}}" +
    "#mitexToasts{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1300;display:flex;flex-direction:column;gap:10px;width:min(92vw,420px);pointer-events:none;}" +
    ".mitex-toast{pointer-events:auto;display:flex;gap:10px;align-items:flex-start;background:var(--card,#151c31);border:1px solid var(--card-border,#2a3550);color:var(--text,#e8ecf4);border-radius:12px;padding:12px 14px;font-size:.9rem;line-height:1.45;box-shadow:0 12px 32px rgba(0,0,0,.4);opacity:0;transform:translateY(10px);animation:mitexToastIn .28s ease forwards;}" +
    ".mitex-toast.out{animation:mitexToastOut .25s ease forwards;}" +
    ".mitex-toast .ico{flex:none;font-size:1.05rem;line-height:1.3;}" +
    ".mitex-toast.success .ico{color:var(--green,#25d366);}" +
    ".mitex-toast.error .ico{color:var(--red,#f87171);}" +
    ".mitex-toast.info .ico{color:#38bdf8;}" +
    ".mitex-toast strong{display:block;margin-bottom:2px;}" +
    "@keyframes mitexToastIn{to{opacity:1;transform:translateY(0);}}" +
    "@keyframes mitexToastOut{to{opacity:0;transform:translateY(10px);}}" +
    ".mitex-skeleton{display:flex;width:100%;height:100%;}" +
    "tr.mitex-skel td{height:46px;border:none;background:transparent;}" +
    ".mitex-skel-bar{position:relative;overflow:hidden;height:14px;border-radius:8px;background:var(--card-border,rgba(255,255,255,.09));}" +
    ".mitex-skel-bar::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.09),transparent);animation:mitexShimmer 1.3s infinite;}" +
    "@keyframes mitexShimmer{to{transform:translateX(100%);}}" +
    ".mitex-empty{padding:38px 18px;text-align:center;color:var(--muted,#9aa5b8);grid-column:1/-1;border:1px dashed var(--card-border,rgba(255,255,255,.12));border-radius:16px;background:transparent;}" +
    ".mitex-empty .empty-ico{font-size:1.7rem;margin-bottom:8px;opacity:.7;}" +
    ".mitex-empty h4{margin:0 0 4px;color:var(--text,#e8ecf4);font-family:'Sora',sans-serif;font-size:1rem;}" +
    ".mitex-empty p{margin:0 0 14px;font-size:.88rem;}" +
    "html{scroll-behavior:smooth;}" +
    "body{animation:mitexPageIn .35s ease both;}" +
    "@keyframes mitexPageIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}" +
    "@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto;}body{animation:none;}.mitex-skel-bar::after,.mitex-toast{animation:none;}}";

  function injectCSS() {
    var style = document.createElement("style");
    style.id = "mitex-ui-css";
    style.textContent = COMPONENT_CSS;
    document.head.appendChild(style);
  }

  function mount() {
    injectCSS();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "mitexThemeBtn";
    btn.title = "Toggle dark / light mode";
    document.body.appendChild(btn);
    btn.addEventListener("click", function () {
      MITEXTheme.toggle();
    });

    var wrap = document.createElement("div");
    wrap.id = "mitexToasts";
    document.body.appendChild(wrap);

    window.showToast = function (message, type, opts) {
      opts = opts || {};
      type = type || "info";
      if (!message) return;
      var toast = document.createElement("div");
      toast.className = "mitex-toast " + type;
      var ico = { success: "&#10003;", error: "&#9888;", info: "&#8505;" }[type] || "&#8505;";
      toast.innerHTML =
        '<span class="ico">' + ico + '</span><div><strong></strong><span class="msg"></span></div>';
      if (opts.title) toast.querySelector("strong").textContent = opts.title;
      toast.querySelector(".msg").textContent = message;
      wrap.appendChild(toast);
      var went = 3200;
      if (opts.duration !== undefined) went = opts.duration;
      setTimeout(function () {
        toast.classList.add("out");
        setTimeout(function () {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 260);
      }, went);
      return toast;
    };

    window.MITEXUi = {
      // Table row skeletons; `cols` is the colspan number.
      skelRows: function (count, cols) {
        count = count || 3;
        cols = cols || 1;
        var out = "";
        for (var r = 0; r < count; r++) {
          out += '<tr class="mitex-skel"><td colspan="' + cols + '">' + skelBars(4) + "</td></tr>";
        }
        return out;
      },
      // Generic list/block skeletons.
      skeleton: skelBars,
      emptyState: function (message, title, icon) {
        return (
          '<div class="mitex-empty"><div class="empty-ico">' +
          (icon || "&darr;") +
          "</div><h4>" +
          esc_(title || "Nothing here yet") +
          "</h4><p>" +
          esc_(message || "") +
          "</p></div>"
        );
      },
      errorState: function (message) {
        return (
          '<div class="mitex-empty" style="border-color:rgba(248,113,113,.4)"><div class="empty-ico">&#9888;</div><h4>Something went wrong</h4><p>' +
          esc_(message || "Please try again.") +
          "</p></div>"
        );
      },
    };

    function skelBars(n) {
      n = n || 3;
      var out = '<div class="mitex-skeleton" style="flex-direction:column;gap:10px;padding:6px 0;">';
      for (var i = 0; i < n; i++) {
        out += '<div class="mitex-skel-bar" style="width:' + (90 - i * 12) + '%;"></div>';
      }
      return out + "</div>";
    }
    function esc_(s) {
      var d = document.createElement("div");
      d.textContent = String(s == null ? "" : s);
      return d.innerHTML;
    }

    applyTheme(currentTheme());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();