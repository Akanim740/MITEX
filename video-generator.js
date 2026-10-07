// UI for the MITEX AI video generator.
//
// api() and isLoggedIn() come from auth.js. The preview is fetched as a blob
// with the Bearer token rather than pointing <img> at the URL: that way the
// preview works from localStorage auth alone and does not depend on the
// refresh cookie still being present.

let lastResult = null;
let lastUrl = null;

function el(id) {
  return document.getElementById(id);
}

function setMessage(node, kind, text) {
  node.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = kind;
  div.textContent = text;
  node.appendChild(div);
}

async function fetchGif(id) {
  const token = localStorage.getItem("mitex_token");
  const res = await fetch(`/api/video/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Preview failed (${res.status})`);
  }
  return res.blob();
}

function renderResult(res, blob) {
  lastResult = res;

  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);

  el("rPreview").src = lastUrl;
  el("dlBtn").href = lastUrl;
  el("dlBtn").download = `${(res.script && res.script.title) || "mitex-video"}.gif`;

  el("rModel").textContent = res.model || "—";
  el("rDims").textContent = `${res.width}×${res.height}`;
  el("rMeta").textContent = `${res.frames} scene${res.frames === 1 ? "" : "s"} · ${Math.round(res.bytes / 1024)} KB`;

  const warn = el("rWarnings");
  warn.innerHTML = "";
  const notes = [];
  if (res.fallback) notes.push("The AI model was unavailable, so this was generated with the built-in template.");
  (res.warnings || []).forEach((w) => notes.push(w));
  notes.forEach((w) => {
    const div = document.createElement("div");
    div.className = "warn";
    div.textContent = w;
    warn.appendChild(div);
  });

  // Built with DOM nodes and textContent: scene copy comes from the model and
  // from whatever the user typed, so it must never reach innerHTML.
  const list = el("rScenes");
  list.innerHTML = "";
  (res.script.scenes || []).forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "scene";

    const head = document.createElement("b");
    head.textContent = `${i + 1}. ${s.text}`;
    row.appendChild(head);

    if (s.subtext) {
      const sub = document.createElement("span");
      sub.textContent = s.subtext;
      row.appendChild(sub);
    }

    const meta = document.createElement("span");
    meta.textContent = `${(s.durationMs / 1000).toFixed(1)}s · ${s.bg} on ${s.fg}`;
    row.appendChild(meta);

    list.appendChild(row);
  });

  el("resultPanel").style.display = "grid";
}

async function generate() {
  const brief = el("vBrief").value.trim();
  const msg = el("formMsg");
  if (!brief) return setMessage(msg, "err", "Describe what the video should say.");
  if (brief.length > 4000) return setMessage(msg, "err", "Brief is too long (max 4000 characters).");

  const btn = el("genBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Rendering…';
  setMessage(msg, "", "");

  try {
    const res = await api("/api/video/generate", {
      method: "POST",
      body: {
        prompt: brief,
        aspect: el("vAspect").value,
        durationSec: Number(el("vDuration").value),
        fadeFrames: Number(el("vFade").value),
      },
    });
    const blob = await fetchGif(res.id);
    renderResult(res, blob);
    el("againBtn").style.display = "inline-flex";
  } catch (e) {
    setMessage(msg, "err", e.message || "Generation failed.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate video";
  }
}

function init() {
  if (!isLoggedIn()) {
    el("loginNote").style.display = "block";
    return;
  }
  el("formPanel").style.display = "grid";
  el("genBtn").addEventListener("click", generate);
  el("againBtn").addEventListener("click", generate);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
