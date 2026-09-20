(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(pointer: fine)");
  var desktop = window.matchMedia("(min-width: 1025px)");

  if (reduceMotion.matches) return;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /* ===== Card tilt (marketplace listings + package cards) ===== */

  function wireTilt(scopeEl, cardSel, strengthX, strengthY, lift) {
    if (!scopeEl || !finePointer.matches) return;
    scopeEl.classList.add("tilt-3d");

    var hovered = null;
    var raf = null;

    function reset() {
      if (!hovered) return;
      hovered.classList.remove("tilting");
      hovered.style.removeProperty("--tilt-x");
      hovered.style.removeProperty("--tilt-y");
      hovered.style.removeProperty("--tilt-lift");
      hovered = null;
    }

    function onMove(e) {
      var card = e.target && e.target.closest ? e.target.closest(cardSel) : null;
      if (card !== hovered) {
        reset();
        hovered = card;
        if (card) card.classList.add("tilting");
      }
      if (!card) return;

      var r = card.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var nx = clamp((e.clientX - r.left) / r.width, 0, 1);
      var ny = clamp((e.clientY - r.top) / r.height, 0, 1);
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        card.style.setProperty("--tilt-x", ((0.5 - ny) * strengthX).toFixed(2) + "deg");
        card.style.setProperty("--tilt-y", ((nx - 0.5) * strengthY).toFixed(2) + "deg");
        card.style.setProperty("--tilt-lift", "-" + lift + "px");
      });
    }

    scopeEl.addEventListener("pointermove", onMove, { passive: true });
    scopeEl.addEventListener("pointerleave", reset);
  }

  var listings = document.getElementById("listingsGrid");
  if (listings) wireTilt(listings, ".listing-card", 5, 6, 5);

  var packages = document.getElementById("packages");
  if (packages) {
    packages.querySelectorAll(".package-card").forEach(function (card) {
      var lv = 4;
      var badge = card.querySelector(".level-badge");
      if (badge) lv = parseInt(badge.textContent.replace(/\D/g, ""), 10) || 4;
      card.style.setProperty("--lv-skew", ((lv - 4) * 0.55).toFixed(2) + "deg");
    });
    wireTilt(packages, ".package-card", 2.5, 3, 4);
  }

  /* ===== Hero WebGL scene (desktop only, graceful fallback) ===== */

  var heroVisual = document.querySelector(".hero-visual");
  if (!heroVisual || !finePointer.matches || !desktop.matches) return;

  function webglOK() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) {
      return false;
    }
  }
  if (!webglOK()) return;

  var canvas = document.createElement("canvas");
  canvas.id = "mitex-3d";
  canvas.setAttribute("aria-hidden", "true");
  heroVisual.insertBefore(canvas, heroVisual.firstChild);

  function cleanupCanvas() {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  import("/vendor/three.module.min.js").then(function (THREE) {
    initScene(THREE);
  }).catch(function () {
    cleanupCanvas();
  });

  function initScene(THREE) {
    var stageEl = heroVisual.querySelector(".browser-stage");
    var shadowEl = heroVisual.querySelector(".browser-shadow");

    if (!stageEl || !shadowEl) {
      cleanupCanvas();
      return;
    }

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (e) {
      cleanupCanvas();
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    heroVisual.classList.add("mitex-3d-on");

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
    camera.position.set(0, -0.12, 6.0);

    var group = new THREE.Group();
    scene.add(group);

    var GOLD = 0xfbbf24;
    var DEEP = 0xbfd4ff;

    /* Orbit rings behind the browser */
    var rings = [];
    function makeRing(radius, opacity, color) {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.012, 8, 128),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false })
      );
      ring.rotation.x = Math.PI / 2.2;
      ring.position.z = -0.7;
      group.add(ring);
      rings.push(ring);
    }
    makeRing(1.5, 0.16, GOLD);
    makeRing(1.9, 0.1, DEEP);

    /* Drifting geometric shards */
    var shardGeo = new THREE.OctahedronGeometry(0.14, 0);
    var mats = [
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.16, depthWrite: false }),
    ];
    var shards = [];
    for (var i = 0; i < 16; i++) {
      var s = new THREE.Mesh(shardGeo, mats[i % 2]);
      var baseX = (Math.random() - 0.5) * 5.4;
      var baseY = (Math.random() - 0.5) * 3.2;
      s.position.set(baseX, baseY, 1 - Math.random() * 4.2);
      var sc = 0.5 + Math.random() * 1.3;
      s.scale.set(sc, sc, sc);
      s.userData = { baseX: baseX, baseY: baseY, sp: 0.5 + Math.random() * 0.9, ph: Math.random() * Math.PI * 2 };
      group.add(s);
      shards.push(s);
    }

    /* Faint translucent glass planes for depth */
    var panelMat = new THREE.MeshBasicMaterial({ color: DEEP, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false });
    var panelGeo = new THREE.PlaneGeometry(0.9, 1.15);
    for (var p = 0; p < 3; p++) {
      var pl = new THREE.Mesh(panelGeo, panelMat);
      pl.position.set((p - 1) * 1.5, (Math.random() - 0.5) * 2.2, -2.2 - p * 0.5);
      pl.rotation.set(Math.random() * 0.5, Math.random() * 0.6 - 0.3, Math.random() * 0.4);
      group.add(pl);
    }

    /* Soft gold core glow behind the browser */
    function makeGlowTexture() {
      var gc = document.createElement("canvas");
      gc.width = gc.height = 128;
      var ctx = gc.getContext("2d");
      var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.35, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(gc);
    }
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: GOLD, transparent: true, opacity: 0.1, depthWrite: false }));
    glow.position.set(0, 0, -1.4);
    glow.scale.set(4.4, 4.4, 1);
    group.add(glow);

    /* Responsive sizing */
    function resize() {
      var w = heroVisual.clientWidth;
      var h = heroVisual.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    var ro = new ResizeObserver(resize);
    ro.observe(heroVisual);

    /* Interaction: cursor + scroll */
    var cursor = { x: 0, y: 0, tx: 0, ty: 0 };
    var scrollT = 0;
    var scrollK = 0;
    var inView = true;

    window.addEventListener("pointermove", function (e) {
      cursor.tx = (e.clientX / window.innerWidth) * 2 - 1;
      cursor.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    window.addEventListener("scroll", function () {
      var heroTop = heroVisual.getBoundingClientRect().top;
      scrollT = clamp((window.innerHeight - heroTop) / window.innerHeight, 0, 1);
    }, { passive: true });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        inView = en.isIntersecting;
      });
    }, { threshold: 0 });
    io.observe(heroVisual);

    var clock = new THREE.Clock();

    function frame() {
      requestAnimationFrame(frame);

      var t = clock.getElapsedTime();
      cursor.x = lerp(cursor.x, cursor.tx, 0.05);
      cursor.y = lerp(cursor.y, cursor.ty, 0.05);
      scrollK = lerp(scrollK, scrollT, 0.04);

      var floatY = Math.sin(t * 0.8) * 0.1;
      group.position.y = -0.15 + floatY * 0.4;
      group.position.z = scrollK * 1.5;
      group.scale.setScalar(1 - scrollK * 0.1);
      group.rotation.y = Math.sin(t * 0.24) * 0.1 + cursor.x * 0.06 + (1 - scrollK) * 0.05 - scrollK * 0.22;
      group.rotation.x = 0.02 + cursor.y * 0.03 + scrollK * 0.12;

      if (rings[0]) rings[0].rotation.z += 0.0016;
      if (rings[1]) rings[1].rotation.z -= 0.0009;

      for (var i = 0; i < shards.length; i++) {
        var s = shards[i];
        var d = s.userData;
        s.position.x = d.baseX + cursor.x * (d.baseX > 0 ? 0.3 : -0.3);
        s.position.y = d.baseY + Math.sin(t * d.sp + d.ph) * 0.12;
        s.rotation.x += 0.002;
        s.rotation.y += 0.003;
      }

      glow.material.opacity = 0.1 + Math.sin(t * 0.9 + 1) * 0.03;

      var browFloat = -6 - Math.sin(t * 0.8) * 5;
      var browRX = -cursor.y * 2.6 + scrollK * 8;
      var browRY = cursor.x * 3.4 + scrollK * 5;
      stageEl.style.transform =
        "translateY(" + browFloat.toFixed(2) + "px) rotateX(" + browRX.toFixed(2) + "deg) rotateY(" + browRY.toFixed(2) + "deg)";
      var liftAmt = -browFloat / 12;
      shadowEl.style.transform =
        "translateX(-50%) scale(" + (1 - liftAmt * 0.22).toFixed(3) + ") translateY(" + (browFloat * 0.4).toFixed(1) + "px)";
      shadowEl.style.opacity = (0.55 - liftAmt * 0.18).toFixed(3);

      if (inView && !document.hidden) {
        camera.position.x = cursor.x * 0.5;
        camera.position.y = -0.12 - cursor.y * 0.32 + floatY * 0.3;
        camera.lookAt(cursor.x * 0.1, -0.12, 0);
        renderer.render(scene, camera);
      }
    }
    requestAnimationFrame(frame);
  }
})();