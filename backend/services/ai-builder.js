// Turns a customer brief into a real, working static website.
//
// The model is treated as an untrusted source. It writes code, and code we
// generate will eventually be served from our infrastructure, so everything it
// returns passes through validateBundle() before a single byte is written to
// disk. Nothing here trusts the model, the prompt, or the customer.
//
// The output contract is deliberately narrow: a self-contained static site of
// HTML/CSS/JS, no build step, no server-side code, no remote dependencies.
// That matches how MITEX already delivers work, so a generated site is
// directly uploadable and hostable.

const ai = require("../utils/ai");
const { generateSiteStub } = require("./ai-builder-stub");

const LIMITS = {
  maxFiles: 40,
  maxTotalBytes: 2 * 1024 * 1024, // 2 MB of source
  maxFileBytes: 512 * 1024, // 512 KB per file
  maxPathLength: 120,
  maxPages: 12,
};

// Extensions we are willing to write. Anything else -- .php, .sh, .exe, .env,
// .sql -- is refused outright rather than sanitised, because there is no
// legitimate reason for a static site bundle to contain executable server code
// and every one of them is a way to escape the sandbox.
const ALLOWED_EXT = new Set([
  ".html", ".htm", ".css", ".js", ".mjs",
  ".json", ".webmanifest", ".xml", ".txt", ".md",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".avif",
]);

// Extensionless files that are still legitimate, so we do not refuse them.
const ALLOWED_BASENAMES = new Set([
  "readme", "license", "robots", "sitemap", "favicon", "humans",
]);

const SYSTEM_PROMPT = [
  "You are MITEX AI, the build engine for MITEX, a marketplace that sells ready-made websites.",
  "",
  "You generate complete, self-contained static websites: plain HTML, CSS and",
  "vanilla JavaScript. There is no build step, no framework, no bundler and no",
  "server-side code. A customer must be able to open index.html or host the",
  "folder anywhere and see a finished site.",
  "",
  "Rules you must follow:",
  "- Reply with ONE JSON object and nothing else. No prose before or after.",
  '- Shape: {"summary": string, "notes": string, "files": [{"path": string, "content": string}]}',
  "- Always include an index.html. Multi-page sites are fine, keep them small.",
  "- Link your own stylesheet and script with relative paths, e.g. styles.css.",
  "- Never reference remote scripts, stylesheets, fonts or images. No CDN",
  "  links, no Google Fonts, no remote <script src>. Everything must be local",
  "  so the site works offline and cannot pull in third-party code.",
  "- Never include <iframe>, <object>, or <embed>.",
  "- Never use javascript: URLs.",
  "- Accessibility is not optional: give the <html> element a lang attribute,",
  "  a <title>, a meta description, one h1, labelled form controls, alt text on",
  "  images, and visible focus styles.",
  "- Be honest in the copy. Do not invent statistics, testimonials, client",
  "  names, awards, company counts or prices. Use clearly labelled placeholder",
  "  text like 'Your Company' where real content is needed.",
  "- Inline SVG is fine. Base64 data: images are fine for small images only.",
  "",
  "Choose a colour palette and type scale deliberately. The site should look",
  "designed, not like a template: considered spacing, a real type hierarchy,",
  "responsive down to 360px wide, and a dark or light theme done consistently.",
].join("\n");

function slugify(value, fallback = "site") {
  const s = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || fallback;
}

/**
 * Validate and normalise a generated bundle.
 *
 * Returns { ok, files, errors, warnings }. Never throws -- callers get the
 * list of problems and decide whether to retry or fail. This is the security
 * boundary, so it is written to be boring and explicit rather than clever.
 */
function validateBundle(rawFiles) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return { ok: false, files: [], errors: ["Model returned no files"], warnings };
  }
  if (rawFiles.length > LIMITS.maxFiles) {
    return {
      ok: false,
      files: [],
      errors: [`Model returned ${rawFiles.length} files, limit is ${LIMITS.maxFiles}`],
      warnings,
    };
  }

  const files = [];
  const seen = new Set();
  let totalBytes = 0;

  for (const entry of rawFiles) {
    const rawPath = entry && typeof entry.path === "string" ? entry.path.trim() : "";
    const content = entry && typeof entry.content === "string" ? entry.content : null;

    if (!rawPath) {
      errors.push("A file entry had no path");
      continue;
    }
    if (content === null) {
      errors.push(`File "${rawPath}" had no string content`);
      continue;
    }

    // Path handling. We normalise separators and a leading "./", but an
    // absolute path is *rejected*, never repaired. Stripping a leading slash
    // would silently turn "/etc/passwd" into "etc/passwd" and "//host/x" into
    // a legitimate-looking nested path, which is how a malformed path sneaks
    // through as if it were intended.
    const path = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const lower = path.toLowerCase();

    if (path.length > LIMITS.maxPathLength) {
      errors.push(`Path too long: ${rawPath.slice(0, 40)}...`);
      continue;
    }
    if (path.startsWith("/")) {
      errors.push(`Refused absolute path "${rawPath}"`);
      continue;
    }
    if (path.includes("..")) {
      errors.push(`Refused path traversal in "${rawPath}"`);
      continue;
    }
    if (/^[a-z]:/i.test(path)) {
      errors.push(`Refused absolute path "${rawPath}"`);
      continue;
    }
    if (lower.includes("\0")) {
      errors.push(`Refused null byte in "${rawPath}"`);
      continue;
    }

    const segments = path.split("/").filter(Boolean);
    if (!segments.length || segments.some((s) => s === "." || s === "..")) {
      errors.push(`Refused suspicious path "${rawPath}"`);
      continue;
    }
    // Files must sit in a real folder under the output root.
    if (segments.some((s) => /[<>:"|?*]/.test(s))) {
      errors.push(`Refused illegal character in path "${rawPath}"`);
      continue;
    }

    const base = segments[segments.length - 1];

    // Dotfiles can carry credentials and are never part of a site bundle.
    // Checked before the extension so the reason we report is accurate.
    if (base.startsWith(".")) {
      errors.push(`Refused dotfile "${rawPath}"`);
      continue;
    }

    const dot = base.lastIndexOf(".");
    const ext = dot === -1 ? "" : base.slice(dot).toLowerCase();
    const stem = dot === -1 ? base.toLowerCase() : base.slice(0, dot).toLowerCase();

    if (ext && !ALLOWED_EXT.has(ext)) {
      errors.push(`Refused disallowed file type "${ext}" in "${rawPath}"`);
      continue;
    }
    if (!ext && !ALLOWED_BASENAMES.has(stem)) {
      errors.push(`Refused extensionless file "${rawPath}"`);
      continue;
    }

    if (seen.has(lower)) {
      errors.push(`Duplicate file "${rawPath}"`);
      continue;
    }
    seen.add(lower);

    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > LIMITS.maxFileBytes) {
      errors.push(`File "${rawPath}" is ${bytes} bytes, limit is ${LIMITS.maxFileBytes}`);
      continue;
    }
    totalBytes += bytes;
    if (totalBytes > LIMITS.maxTotalBytes) {
      errors.push(`Bundle exceeds ${LIMITS.maxTotalBytes} bytes total`);
      break;
    }

    files.push({ path, content, bytes });
  }

  if (totalBytes <= LIMITS.maxTotalBytes) {
    if (totalBytes > LIMITS.maxTotalBytes * 0.9) {
      warnings.push(`Bundle is close to the size limit (${totalBytes} bytes)`);
    }
  }

  // Content inspection. These are the rules that matter most, because they are
  // what stops a generated site from phoning home or running remote code when
  // a customer opens it.
  for (const f of files) {
    const isMarkup = /\.(html?|svg|xml|webmanifest|json|txt|md|js|mjs|css)$/i.test(f.path);
    if (!isMarkup) continue;

    const c = f.content;

    if (/\bjavascript\s*:/i.test(c)) {
      errors.push(`Refused javascript: URL in "${f.path}"`);
    }
    // data: URLs are allowed only for images. A data:text/html or
    // data:application/* URL carries executable markup, so following one runs
    // script that no review step ever saw.
    if (/\bdata:(?!image\/)/i.test(c)) {
      errors.push(`Refused non-image data: URL in "${f.path}"`);
    }
    if (/<\s*(iframe|object|embed)\b/i.test(c)) {
      errors.push(`Refused embedded frame/object in "${f.path}"`);
    }
    // Remote subresources in markup and CSS. This is the supply-chain hole:
    // a generated page that pulls a script from someone else's host executes
    // code the customer never reviewed.
    const remote = c.match(
      /(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\/[^"']+|\b(?:url|@import)\s*\(\s*["']?\s*(?:https?:)?\/\//gi
    );
    if (remote) {
      errors.push(`Refused remote reference in "${f.path}": ${remote[0].slice(0, 60)}`);
    }
    // Credentials or keys baked into a bundle.
    if (/(sk-ant-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(c)) {
      errors.push(`Refused credential-shaped content in "${f.path}"`);
    }
  }

  const htmlCount = files.filter((f) => /\.html?$/i.test(f.path)).length;
  if (htmlCount === 0) errors.push("Bundle has no HTML page");
  if (htmlCount > LIMITS.maxPages) errors.push(`Bundle has ${htmlCount} pages, limit is ${LIMITS.maxPages}`);
  if (!files.some((f) => f.path.toLowerCase() === "index.html")) {
    warnings.push('Bundle has no top-level index.html');
  }

  const deduped = [];
  for (const e of errors) if (!deduped.includes(e)) deduped.push(e);

  return { ok: errors.length === 0, files: errors.length === 0 ? files : [], errors: deduped, warnings };
}

function buildPrompt({ brief, kind, existingFiles, extraNotes }) {
  const lines = [];

  if (kind === "fix") {
    lines.push("A customer has an existing website that needs work. Fix it.", "");
    lines.push("The customer says:", String(brief || "").trim() || "(no detail given)");
    lines.push("");
    if (Array.isArray(existingFiles) && existingFiles.length) {
      lines.push("Here is the current source. Return the corrected complete files.");
      for (const f of existingFiles) {
        if (!f || typeof f.content !== "string") continue;
        lines.push("");
        lines.push("--- FILE: " + String(f.path || "untitled") + " ---");
        // Guard the prompt itself: a huge upload should not become a huge bill.
        lines.push(f.content.slice(0, 120000));
      }
    } else {
      lines.push("No source was supplied, so produce a clean implementation of what they described.");
    }
  } else {
    lines.push("A customer wants a brand new website. Build it.", "");
    lines.push("The customer says:", String(brief || "").trim() || "(no detail given)");
  }

  if (extraNotes) {
    lines.push("", "Additional requirements:", String(extraNotes).trim());
  }

  lines.push(
    "",
    "Return only the JSON object described in your instructions.",
    'Use "summary" for one plain sentence describing what you built, and "notes"',
    "for what the customer still needs to supply (real copy, logo, images).",
    "Be specific and avoid generic filler."
  );

  return lines.join("\n");
}

async function generateSite({ brief, kind = "build", existingFiles = [], extraNotes, signal } = {}) {
  // Force stub mode if explicitly requested, or if no API key configured.
  const forceStub = String(process.env.AI_STUB || "").toLowerCase() === "true";
  if (forceStub || !ai.isConfigured()) {
    return generateSiteStub({ brief, kind, existingFiles, extraNotes, signal });
  }

  try {
    const res = await ai.completeJson({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt({ brief, kind, existingFiles, extraNotes }),
      maxTokens: Number(process.env.AI_BUILD_MAX_TOKENS || 32000),
      signal,
    });

    const data = res.data && typeof res.data === "object" ? res.data : {};
    const rawFiles = Array.isArray(data.files) ? data.files : [];

    const checked = validateBundle(rawFiles);

    return {
      ok: checked.ok,
      files: checked.files,
      errors: checked.errors,
      warnings: checked.warnings,
      summary: String(data.summary || "").slice(0, 500),
      notes: String(data.notes || "").slice(0, 2000),
      usage: res.usage,
      model: res.model,
    };
  } catch (err) {
    // If API fails due to billing/keys being misconfigured, fall back to stub
    // so the feature is still usable without spending credits.
    const msg = String(err && err.message || "").toLowerCase();
    if (err && (err.status === 400 || err.status === 401 || err.status === 402 || err.status === 403 || err.status >= 500 || msg.includes("credit balance") || msg.includes("scope to a workspace") || msg.includes("api key") || msg.includes("workspace"))) {
      if (String(process.env.AI_STUB_FALLBACK || "true").toLowerCase() !== "false") {
        const res = await generateSiteStub({ brief, kind, existingFiles, extraNotes, signal });
        res._fallback = { reason: err.message, status: err.status || null };
        return res;
      }
    }
    throw err;
  }
}

module.exports = {
  generateSite,
  validateBundle,
  buildPrompt,
  slugify,
  LIMITS,
  ALLOWED_EXT,
  SYSTEM_PROMPT,
};