(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(pointer: fine)");

  var heroVisual = document.querySelector(".hero-visual");
  if (!heroVisual) return;

  var scene = heroVisual.querySelector(".dev-scene");
  var video = heroVisual.querySelector(".dev-video");
  if (!scene || !video) return;

  heroVisual.classList.add("dev-scene-ready");

  /* ===== 1. Lazy-load + autoplay the footage ===== */

  var booted = false;
  function bootVideo() {
    if (booted || reduceMotion.matches) return;
    booted = true;
    video.src = video.getAttribute("data-src") || "video/dev-scene.webm";
    video.load();
    video.play().catch(function () {});
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            bootVideo();
            io.disconnect();
          }
        });
      },
      { rootMargin: "80px" }
    );
    io.observe(scene);
  } else {
    bootVideo();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      video.pause();
    } else if (booted) {
      video.play().catch(function () {});
    }
  });

  /* ===== 2. Monitor 1: code typewriter loop ===== */

  var typeEl = document.querySelector(".scr-code .type");
  if (typeEl && !reduceMotion.matches) {
    var snippets = [
      "await build(idea);",
      "site.ship(\"ms01\");",
      "deploy().then(goLive)",
    ];
    var si = 0;
    var ci = 0;
    var del = false;
    var pause = 0;
    var last = 0;

    function step(ts) {
      if (pause > 0) {
        if (ts - last > pause) {
          pause = 0;
          last = ts;
          del = true;
        }
        requestAnimationFrame(step);
        return;
      }
      var sn = snippets[si];
      if (del) {
        ci--;
        if (ci < 0) {
          del = false;
          si = (si + 1) % snippets.length;
        }
      } else {
        ci++;
        if (ci > sn.length) {
          ci = sn.length;
          pause = 2600;
          last = ts;
          requestAnimationFrame(step);
          return;
        }
      }
      typeEl.textContent = sn.slice(0, ci) + (del ? "" : "");
      if (ci === sn.length && !del) typeEl.textContent = sn;
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ===== 3. Monitor 2: wireframe <-> polished cross-fade ===== */

  var uiMock = document.querySelector(".scr-ui .mock");
  if (uiMock && !reduceMotion.matches) {
    var wire = true;
    setInterval(function () {
      wire = !wire;
      uiMock.classList.toggle("done", !wire);
    }, 5200);
  }

  /* ===== 4. Camera: damped mouse parallax + subtle scroll drift ===== */

  if (finePointer.matches && !reduceMotion.matches) {
    var targetX = 0;
    var targetY = 0;
    var curX = 0;
    var curY = 0;

    window.addEventListener(
      "pointermove",
      function (e) {
        var r = scene.getBoundingClientRect();
        if (!r.width || !r.height) return;
        targetX = ((e.clientX - r.left) / r.width - 0.5) * 16;
        targetY = ((e.clientY - r.top) / r.height - 0.5) * 12;
      },
      { passive: true }
    );

    (function raf() {
      curX += (targetX - curX) * 0.05;
      curY += (targetY - curY) * 0.05;
      scene.style.setProperty("--ds-px", curX.toFixed(2) + "px");
      scene.style.setProperty("--ds-py", curY.toFixed(2) + "px");
      requestAnimationFrame(raf);
    })();
  }

  /* Scroll exit: slight rise + fade as the hero leaves the viewport. */
  var heroEl = heroVisual; /* .hero is the scroll container */
  var heroRoot = heroVisual.parentElement;
  if (heroRoot) heroEl = heroRoot;
  window.addEventListener(
    "scroll",
    function () {
      var h = heroEl.getBoundingClientRect();
      var out = h.top < -h.height * 0.25;
      scene.classList.toggle("scrolled", out);
    },
    { passive: true }
  );
})();