const express = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { requireAuth, requireAuthFlexible } = require("../middleware/auth");

const router = express.Router();

// Rendering spawns a process and burns CPU, so this is tighter than the
// token-based AI limits.
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many renders. Try again later." },
});

// Videos are a self-contained tool rather than a paid deliverable, so they are
// stored on disk instead of in the pluggable database -- no payment, delivery
// or per-adapter schema is involved. Metadata rides alongside the file as JSON.
const VIDEO_DIR = path.join(__dirname, "..", "data", "videos");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PROMPT = 4000;

// ids are random, but they are also used as filenames, so they are validated
// against a strict pattern rather than sanitised after the fact.
const ID_RE = /^[a-z0-9]{16,32}$/i;

function ensureDir() {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const name of fs.readdirSync(VIDEO_DIR)) {
    const full = path.join(VIDEO_DIR, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* a file disappearing mid-prune is fine */
    }
  }
}

function metaPath(id) {
  return path.join(VIDEO_DIR, `${id}.json`);
}

function gifPath(id) {
  return path.join(VIDEO_DIR, `${id}.gif`);
}

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}

function canView(meta, req) {
  if (!meta) return false;
  const role = String((req.user && req.user.role) || "").toLowerCase();
  if (role === "admin" || role === "editor" || role === "staff") return true;
  return String(meta.userId) === String(req.user.id);
}

// POST /api/video/generate -- prompt in, animated GIF stored, metadata back.
// requireAuth: a generated request carries the Bearer token from auth.js.
router.post("/generate", requireAuth, generateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Describe what the video should say" });
    if (prompt.length > MAX_PROMPT) {
      return res.status(400).json({ error: `Brief is too long (max ${MAX_PROMPT} characters)` });
    }

    const aspect = ["landscape", "square", "portrait"].includes(body.aspect)
      ? body.aspect
      : "landscape";
    const durationSec = Math.min(30, Math.max(4, Number(body.durationSec) || 12));
    const fadeFrames = Math.min(6, Math.max(0, Number(body.fadeFrames) || 0));

    const { generateVideo } = require("../services/ai-video-generator");
    const result = await generateVideo({ prompt, aspect, durationSec, fadeFrames });

    ensureDir();
    prune();

    const id = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(gifPath(id), result.gif);

    const meta = {
      id,
      userId: req.user.id,
      prompt,
      aspect,
      durationSec,
      fadeFrames,
      script: result.script,
      warnings: result.warnings,
      model: result.model,
      usage: result.usage,
      fallback: result._fallback,
      width: result.width,
      height: result.height,
      frames: result.frames,
      bytes: result.bytes,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath(id), JSON.stringify(meta), "utf8");

    res.json({
      ok: true,
      id,
      src: `/api/video/${id}`,
      script: result.script,
      warnings: result.warnings,
      model: result.model,
      width: result.width,
      height: result.height,
      frames: result.frames,
      bytes: result.bytes,
      fallback: result._fallback,
    });
  } catch (e) {
    console.error("[video] generate:", e);
    const status = e.code === "VALIDATION_FAILED" ? 422 : e.status || 500;
    res.status(status).json({
      error: e.message || "Render failed",
      details: e.errors || undefined,
    });
  }
});

// GET /api/video/:id -- preview inline, or download with ?download=1
// requireAuthFlexible: the preview is loaded via <img src> and downloads via
// a plain link, neither of which carries an Authorization header, so the
// refresh cookie has to be accepted here.
router.get("/:id", requireAuthFlexible, (req, res) => {
  const id = String(req.params.id || "");
  if (!ID_RE.test(id)) return res.status(400).json({ error: "Bad id" });

  const meta = readMeta(id);
  if (!meta) return res.status(404).json({ error: "Video not found" });
  if (!canView(meta, req)) return res.status(403).json({ error: "Not your video" });

  const file = gifPath(id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Video file missing" });

  const stat = fs.statSync(file);
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Length", String(stat.size));
  // Stored videos are generated from user copy, so keep them out of any
  // shared cache that might otherwise serve one user's render to another.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.query.download === "1") {
    const safe = String(meta.script.title || "video").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "video";
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.gif"`);
  }
  fs.createReadStream(file).pipe(res);
});

// GET /api/video/:id/meta -- script only, for re-rendering or editing
router.get("/:id/meta", requireAuth, (req, res) => {
  const id = String(req.params.id || "");
  if (!ID_RE.test(id)) return res.status(400).json({ error: "Bad id" });
  const meta = readMeta(id);
  if (!meta) return res.status(404).json({ error: "Video not found" });
  if (!canView(meta, req)) return res.status(403).json({ error: "Not your video" });
  res.json({ ok: true, video: meta });
});

module.exports = router;
