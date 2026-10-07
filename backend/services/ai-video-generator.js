// AI video generator for content creation.
//
// Pipeline is three separate stages so each can fail, and be tested, on its
// own: the model writes a scene script, render-frames.ps1 rasterises those
// scenes with real fonts, and utils/gif.js encodes the result. Nothing here
// needs a build step or an image dependency.
//
// Output is an animated GIF today because ffmpeg cannot be installed in this
// environment. renderGif is the single place that knows this, so switching to
// MP4 later means replacing that function, not the caller.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const ai = require("../utils/ai");
const { encodeGif } = require("../utils/gif");
const { generateVideoScriptStub } = require("./ai-video-stub");

const RENDERER = path.join(__dirname, "..", "scripts", "render-frames.ps1");

const ASPECTS = {
  landscape: { width: 640, height: 360 },
  square: { width: 640, height: 640 },
  portrait: { width: 360, height: 640 },
};

const LIMITS = {
  minScenes: 2,
  maxScenes: 8,
  maxTitle: 60,
  maxText: 70,
  maxSubtext: 90,
  minDurationMs: 1500,
  maxDurationMs: 8000,
  maxTotalMs: 60000,
  minFadeFrames: 0,
  maxFadeFrames: 6,
};

const HEX6 = /^#(?:[0-9a-f]{6})$/i;
const HEX3 = /^#(?:[0-9a-f]{3})$/i;

const SYSTEM_PROMPT = [
  "You write short text-on-screen scripts for social video.",
  "Return ONLY a JSON object, no prose, no markdown fences.",
  "Schema:",
  '{"title":string,"scenes":[{"text":string,"subtext":string,"bg":"#rrggbb","fg":"#rrggbb","accent":"#rrggbb","durationMs":number}]}',
  `Return between ${LIMITS.minScenes} and ${LIMITS.maxScenes} scenes.`,
  `text: at most ${LIMITS.maxText} characters, the main line. subtext: at most ${LIMITS.maxSubtext} characters, optional.`,
  `durationMs: ${LIMITS.minDurationMs} to ${LIMITS.maxDurationMs}.`,
  "bg/fg/accent are six-digit hex colours. Keep fg legible against bg.",
  "Write punchy, concrete lines. No hashtag stuffing, no emoji.",
  "NEVER invent facts: no statistics, no prices, no customer names, no testimonials,",
  "no awards, no ratings, no performance or speed claims you cannot know.",
  "If the brief does not state something, do not state it either.",
].join("\n");

function cleanText(value, max) {
  const stripped = String(value || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= max) return stripped;
  const cut = stripped.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return (boundary > max * 0.5 ? cut.slice(0, boundary) : cut).trim();
}

// Returns the normalised colour, or null when the input is not a colour at
// all. Callers decide the fallback so they can also report the substitution --
// silently repairing bad model output hides a systematic prompt problem.
function normalizeHex(value) {
  const v = String(value || "").trim();
  if (HEX6.test(v)) return v.toLowerCase();
  if (HEX3.test(v)) {
    return ("#" + v.slice(1).split("").map((c) => c + c).join("")).toLowerCase();
  }
  return null;
}

/**
 * Clamp an untrusted script (model output) into something safe to render.
 *
 * Everything reaching the renderer is bounded: colour strings are pattern
 * matched rather than passed through, durations are clamped, and scene count
 * is capped so a model cannot make us render a thousand frames.
 */
function validateScript(raw, { aspect = "landscape" } = {}) {
  const errors = [];
  const warnings = [];
  const data = raw && typeof raw === "object" ? raw : {};
  const resolvedAspect = ASPECTS[aspect] ? aspect : "landscape";
  const rawScenes = Array.isArray(data.scenes) ? data.scenes : [];

  if (rawScenes.length < LIMITS.minScenes) {
    errors.push(`Need at least ${LIMITS.minScenes} scenes, got ${rawScenes.length}`);
  }

  const scenes = [];
  let reportedColour = 0;
  const colour = (raw, fallback, field) => {
    if (raw == null || String(raw).trim() === "") return fallback;
    const hex = normalizeHex(raw);
    if (hex) return hex;
    if (reportedColour < 3) warnings.push(`${field} "${String(raw).slice(0, 24)}" is not a valid colour; using ${fallback}`);
    reportedColour++;
    return fallback;
  };

  for (let i = 0; i < rawScenes.length && scenes.length < LIMITS.maxScenes; i++) {
    const s = rawScenes[i] && typeof rawScenes[i] === "object" ? rawScenes[i] : {};
    const text = cleanText(s.text, LIMITS.maxText);
    if (!text) {
      if (scenes.length < LIMITS.minScenes) errors.push(`Scene ${i + 1} has no text`);
      continue;
    }
    scenes.push({
      text,
      subtext: cleanText(s.subtext, LIMITS.maxSubtext),
      durationMs: Math.min(
        LIMITS.maxDurationMs,
        Math.max(LIMITS.minDurationMs, Math.round(Number(s.durationMs) || 3000))
      ),
      bg: colour(s.bg, "#0f172a", `Scene ${i + 1} bg`),
      fg: colour(s.fg, "#f0f2f5", `Scene ${i + 1} fg`),
      accent: colour(s.accent, "#4f46e5", `Scene ${i + 1} accent`),
    });
  }

  if (scenes.length < LIMITS.minScenes) {
    errors.push(`Only ${scenes.length} usable scene(s) after validation`);
  }

  if (scenes.length < rawScenes.length) {
    warnings.push(`${rawScenes.length - scenes.length} scene(s) dropped as empty or over the limit`);
  }

  let total = scenes.reduce((sum, s) => sum + s.durationMs, 0);
  if (total > LIMITS.maxTotalMs) {
    const scale = LIMITS.maxTotalMs / total;
    scenes.forEach((s) => {
      s.durationMs = Math.max(LIMITS.minDurationMs, Math.round((s.durationMs * scale) / 100) * 100);
    });
    warnings.push("Total runtime trimmed to stay under the length limit");
  }

  return {
    ok: errors.length === 0,
    script: {
      title: cleanText(data.title, LIMITS.maxTitle) || "MITEX video",
      aspect: resolvedAspect,
      scenes,
    },
    errors,
    warnings,
  };
}

async function generateVideoScript({ prompt, aspect = "landscape", durationSec = 12, signal } = {}) {
  const forceStub = String(process.env.AI_STUB || "").toLowerCase() === "true";
  if (forceStub || !ai.isConfigured()) {
    return generateVideoScriptStub({ prompt, aspect, durationSec, signal });
  }

  try {
    const res = await ai.completeJson({
      system: SYSTEM_PROMPT,
      prompt: [
        `Aspect: ${aspect} (${ASPECTS[aspect].width}x${ASPECTS[aspect].height}).`,
        `Target total runtime: about ${durationSec} seconds.`,
        `Topic / brief: ${String(prompt || "").slice(0, 4000)}`,
      ].join("\n"),
      maxTokens: Number(process.env.AI_VIDEO_MAX_TOKENS || 8000),
      signal,
    });

    const checked = validateScript(res.data, { aspect });
    return { ...checked, usage: res.usage, model: res.model };
  } catch (err) {
    // Billing and key problems should not make the feature unusable -- fall
    // back to the stub exactly as ai-builder does, and say so loudly.
    const msg = String((err && err.message) || "").toLowerCase();
    const stubbable =
      err &&
      (err.status === 400 ||
        err.status === 401 ||
        err.status === 402 ||
        err.status === 403 ||
        err.status >= 500 ||
        msg.includes("credit balance") ||
        msg.includes("scope to a workspace") ||
        msg.includes("api key") ||
        msg.includes("workspace"));

    if (stubbable && String(process.env.AI_STUB_FALLBACK || "true").toLowerCase() !== "false") {
      const res = await generateVideoScriptStub({ prompt, aspect, durationSec, signal });
      res._fallback = { reason: err.message, status: err.status || null };
      return res;
    }
    throw err;
  }
}

// GDI+ hands back Format24bppRgb, which despite the name is byte-ordered BGR.
// Swapping here rather than in the renderer keeps the PowerShell side a dumb
// memcpy, which matters because a per-pixel loop in PowerShell is very slow.
function toRgb(buf) {
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const t = buf[i];
    buf[i] = buf[i + 2];
    buf[i + 2] = t;
  }
  return buf;
}

function blendFrames(a, b, count) {
  const out = [];
  for (let step = 1; step <= count; step++) {
    const t = step / (count + 1);
    const frame = Buffer.allocUnsafe(a.length);
    for (let i = 0; i < a.length; i++) {
      frame[i] = Math.round(a[i] + (b[i] - a[i]) * t);
    }
    out.push(frame);
  }
  return out;
}

function runRenderer(specFile, outFile) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        RENDERER,
        "-SpecFile",
        specFile,
        "-OutRaw",
        outFile,
      ],
      { timeout: 60000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `Frame renderer failed: ${(stderr || err.message || "").trim().slice(0, 400)}`
            )
          );
          return;
        }
        resolve(String(stdout || "").trim());
      }
    );
  });
}

/**
 * Rasterise scenes and encode them as an animated GIF.
 *
 * @param {object} script validated output of validateScript
 * @param {object} [opts]
 * @param {number} [opts.fadeFrames] frames blended between scenes (0 disables)
 * @param {number} [opts.fadeMs] duration of each crossfade
 * @returns {Promise<Buffer>}
 */
async function renderGif(script, { fadeFrames = 4, fadeMs = 600 } = {}) {
  const dims = ASPECTS[script.aspect] || ASPECTS.landscape;
  const scenes = script.scenes;
  const fade = Math.min(LIMITS.maxFadeFrames, Math.max(LIMITS.minFadeFrames, fadeFrames | 0));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mitex-video-"));
  const specFile = path.join(tmp, "spec.json");
  const outFile = path.join(tmp, "frames.raw");

  try {
    fs.writeFileSync(
      specFile,
      JSON.stringify({ width: dims.width, height: dims.height, scenes }),
      "utf8"
    );
    await runRenderer(specFile, outFile);

    const raw = toRgb(fs.readFileSync(outFile));
    const frameBytes = dims.width * dims.height * 3;
    if (raw.length !== frameBytes * scenes.length) {
      throw new Error(
        `Renderer produced ${raw.length} bytes, expected ${frameBytes * scenes.length}`
      );
    }

    const sceneFrames = [];
    for (let i = 0; i < scenes.length; i++) {
      sceneFrames.push(raw.subarray(i * frameBytes, (i + 1) * frameBytes));
    }

    // Hold each scene, then blend into the next one. Fading is done on RGB
    // before quantisation so the palette stays stable across the whole clip
    // and the crossfade does not flicker.
    const frames = [];
    const delays = [];
    for (let i = 0; i < sceneFrames.length; i++) {
      frames.push(sceneFrames[i]);
      delays.push(Math.round(scenes[i].durationMs / 10));

      const next = sceneFrames[i + 1];
      if (next && fade > 0) {
        const blended = blendFrames(sceneFrames[i], next, fade);
        const perFade = Math.max(2, Math.round(fadeMs / fade / 10));
        for (const f of blended) {
          frames.push(f);
          delays.push(perFade);
        }
      }
    }

    return encodeGif({
      width: dims.width,
      height: dims.height,
      frames,
      delays,
      loop: 0,
      maxColors: 256,
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Full pipeline: prompt in, animated GIF out.
 */
async function generateVideo({ prompt, aspect, durationSec, fadeFrames, fadeMs, signal } = {}) {
  const result = await generateVideoScript({ prompt, aspect, durationSec, signal });
  if (!result.ok) {
    const err = new Error(result.errors.join("; ") || "Video script failed validation");
    err.code = "VALIDATION_FAILED";
    err.errors = result.errors;
    throw err;
  }

  const gif = await renderGif(result.script, { fadeFrames, fadeMs });

  return {
    ok: true,
    gif,
    script: result.script,
    errors: result.errors,
    warnings: result.warnings || [],
    usage: result.usage || { inputTokens: 0, outputTokens: 0 },
    model: result.model,
    frames: result.script.scenes.length,
    width: (ASPECTS[result.script.aspect] || ASPECTS.landscape).width,
    height: (ASPECTS[result.script.aspect] || ASPECTS.landscape).height,
    bytes: gif.length,
    _fallback: result._fallback || null,
  };
}

module.exports = {
  generateVideo,
  generateVideoScript,
  validateScript,
  renderGif,
  ASPECTS,
  LIMITS,
  SYSTEM_PROMPT,
};
