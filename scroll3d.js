(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(pointer: fine)");
  var desktop = window.matchMedia("(min-width: 1025px)");

  if (reduceMotion.matches) return;
  if (!finePointer.matches) return;
  if (!desktop.matches) return;
  if (!document.querySelector(".hero-visual")) return;

  document.documentElement.classList.add("fx-3d");
})();