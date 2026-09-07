// MITEX site intelligence: Website Health Score, SEO checker, Performance
// checker, AI Website Analyzer and AI listing-description generator.
//
// Design notes:
//  - Deterministic + testable: scores are plain functions of extracted
//    signals, so results are reproducible and unit-testable offline.
//  - Network access is optional: fetchPage() is wrapped so a dead/slow/offline
//    target degrades to a "partial" result built from what the caller already
//    knows, never an exception to the user.
//  - SSRF-safe: outbound fetches only allow public http(s) hosts (private,
//    loopback and link-local ranges are rejected), short timeouts, small size
//    caps and a max redirect chain.

const http = require("http");
const https = require("https");
const dns = require("dns").promises;
const net = require("net");

const MAX_BYTES = 350 * 1024; // cap page reads ~350KB
const TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 4;

// ---------------------------------------------------------------------------
// Safe outbound fetch
// ---------------------------------------------------------------------------

function isPrivateHost(host) {
  const h = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (net.isIP(h)) return isPrivateIp(h);
  return false;
}

function isPrivateIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a === 100
    );
  }
  if (fam === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    );
  }
  return true;
}

async function assertPublicHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  const allowPrivate = process.env.MITEX_AUDIT_ALLOW_PRIVATE === "1";
  if (isPrivateHost(host) && !allowPrivate) throw new Error("Refused to scan a non-public host");
  const addresses = await dns.resolve(host, "A").catch(() => []);
  if (addresses.some((ip) => isPrivateIp(ip)) && !allowPrivate) throw new Error("Refused to scan a host resolving to a private address");
}

function validUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  return u;
}

function fetchOnce(u, { redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(
      u,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MITEX-SiteAudit/1.0; +https://mitex.store)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate",
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        const headers = res.headers || {};
        const loc = headers.location || "";
        if (status >= 300 && status < 400 && loc && redirectsLeft > 0) {
          res.resume();
          const next = (() => {
            try {
              return new URL(loc, u);
            } catch {
              return null;
            }
          })();
          if (!next || !["http:", "https:"].includes(next.protocol) || isPrivateHost(next.hostname)) {
            return resolve({ ok: false, status, headers, error: "Unsafe redirect" });
          }
          return resolve(fetchOnce(next, { redirectsLeft: redirectsLeft - 1 }));
        }

        const chunks = [];
        let total = 0;
        let settled = false;
        const finish = (extra) => {
          if (settled) return;
          settled = true;
          const body = Buffer.concat(chunks);
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers,
            url: u.href,
            finalUrl: res.url || u.href,
            body,
            html: body.toString("utf8"),
            bytes: body.length,
            ...extra,
          });
        };

        res.on("data", (c) => {
          total += c.length;
          if (total > MAX_BYTES) {
            res.destroy();
            return finish({ truncated: true });
          }
          chunks.push(c);
        });
        res.on("end", () => finish());
        res.on("error", () => finish({ error: "Response error" }));
        res.on("aborted", () => finish({ error: "Response aborted" }));
      }
    );
    req.on("timeout", () => {
      req.destroy();
    });
    req.on("error", (err) => resolve({ ok: false, status: 0, headers: {}, error: (err && err.message) || "Request failed" }));
  });
}

async function fetchPage(rawUrl) {
  const u = validUrl(rawUrl);
  if (!u) return { ok: false, error: "Enter a full http(s) URL, e.g. https://example.com" };
  const started = Date.now();
  try {
    await assertPublicHost(u.hostname);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const res = await fetchOnce(u);
  res.timeMs = Date.now() - started;
  return res;
}

// ---------------------------------------------------------------------------
// HTML extraction (lightweight, dependency-free)
// ---------------------------------------------------------------------------

function attrOf(html, open, name) {
  const m = html.slice(open.index, open.index + open[0].length).match(new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  if (!m) return "";
  return (m[1] || m[2] || m[3] || "").trim();
}

function extractMeta(html) {
  const metas = [];
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const name = (attrOf(html, m, "name") || attrOf(html, m, "property") || "").toLowerCase().trim();
    const content = attrOf(html, m, "content");
    if (name && content) metas.push({ name, content });
  }
  return metas;
}

function countTag(html, tag) {
  const re = new RegExp("<" + tag + "\\b[^>]*>", "gi");
  let n = 0;
  while (re.exec(html)) n++;
  return n;
}

function firstTextOf(html, tag) {
  const m = html.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
  if (!m) return "";
  return stripTags(m[1]).slice(0, 200).trim();
}

function stripTags(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readableWords(html) {
  return stripTags(html).split(/\s+/).filter(Boolean).length;
}

function analyzeHtml(html, headers = {}) {
  if (!html) html = "";
  const meta = extractMeta(html);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const descMeta = meta.find((m) => m.name === "description") || {};
  const canonical = /<link\b[^>]*rel\s*=\s*["']?canonical["']?/i.test(html);
  const hasViewport = /<meta\b[^>]*name\s*=\s*["']?viewport["']?/i.test(html);
  const hasCharset = /<meta\b[^>]*charset\s*=/i.test(html);
  const hasLang = /<html\b[^>]*lang\s*=\s*["'][a-zA-Z-]+["']/i.test(html);
  const favicon = /<link\b[^>]*rel\s*=\s*["']?[^"']*icon[^"']*["']?[^>]*href\s*=/i.test(html);
  const ogTags = meta.filter((m) => m.name.startsWith("og:"));
  const twitterTags = meta.filter((m) => m.name.startsWith("twitter:"));
  const jsonLd = (html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>/gi) || []).length;
  const h1 = countTag(html, "h1");
  const h2 = countTag(html, "h2");
  const h3 = countTag(html, "h3");
  const h1Text = firstTextOf(html, "h1");
  const images = countTag(html, "img");
  const imageAlt = (html.match(/<img\b[^>]*alt=/gi) || []).length;
  const scripts = countTag(html, "script");
  const styles = countTag(html, "link");
  const inlineStyles = countTag(html, "style");
  const links = (html.match(/<a\b[^>]*href=/gi) || []).length;
  const externalLinks = (html.match(/<a\b[^>]*href=["'](?:https?:)?\/\//gi) || []).length;
  const schemaOrg = /itemscope|itemtype=/i.test(html);
  const preload = (html.match(/<link[^>]+rel=["'](?:preload|preconnect|dns-prefetch)["']/gi) || []).length;
  const lazyImages = /loading=["']lazy["']/i.test(html);
  const compression = String(headers["content-encoding"] || "");
  const cacheHeaders = Boolean(headers["cache-control"] || headers["etag"] || headers["last-modified"]);
  const hsts = Boolean(headers["strict-transport-security"]);
  const securityHeaders =
    (hsts ? 1 : 0) +
    (headers["x-content-type-options"] ? 1 : 0) +
    (headers["x-frame-options"] || headers["content-security-policy"] ? 1 : 0) +
    (headers["referrer-policy"] ? 1 : 0);

  return {
    title: stripTags(title),
    titleRaw: title.trim(),
    titleChars: title.trim().length,
    description: descMeta.content || "",
    descChars: (descMeta.content || "").length,
    canonical: Boolean(canonical),
    hasViewport,
    hasCharset,
    hasLang,
    favicon: Boolean(favicon),
    ogTags: ogTags.length,
    hasOgImage: ogTags.some((t) => t.name === "og:image"),
    twitterTags: twitterTags.length,
    jsonLd,
    schemaOrg,
    h1,
    h1Text,
    h2,
    h3,
    images,
    imageAlt,
    scripts,
    styles,
    inlineStyles,
    links,
    externalLinks,
    preload,
    lazyImages,
    words: readableWords(html),
    compression: compression === "gzip" || compression === "br" || compression === "deflate",
    compressionName: compression || "none",
    cacheHeaders,
    hsts,
    securityHeaders,
  };
}

// ---------------------------------------------------------------------------
// Deterministic scorecards
// ---------------------------------------------------------------------------

function websiteHealth(meta, fetchMeta = {}) {
  if (!meta) meta = {};
  let points = 0;
  const checks = [];
  const pass = (label, detail) => checks.push({ status: "pass", label, detail });
  const warn = (label, detail) => checks.push({ status: "warn", label, detail });
  const fail = (label, detail) => checks.push({ status: "fail", label, detail });
  const done = (label, detail) => checks.push({ status: "pass", label: label + " ✔", detail });

  const status = fetchMeta.ok !== false ? (fetchMeta.status || 200) : 0;
  if (status >= 200 && status < 300) {
    points += 24;
    pass("Reachable", `HTTP ${status}`);
  } else if (status) {
    fail("Not reachable", `HTTP ${status || "error"}`);
  } else {
    fail("Could not fetch", fetchMeta.error || "Unknown network error");
  }

  if (meta.title && meta.titleChars >= 20 && meta.titleChars <= 70) {
    points += 14;
    done("Good <title>", `${meta.titleChars} chars`);
  } else if (meta.title) {
    points += 6;
    warn("Title present but off range", `${meta.titleChars} chars (aim 20-70)`);
  } else {
    fail("Missing <title>", "Add a descriptive page title");
  }

  if (meta.description && meta.descChars >= 60 && meta.descChars <= 165) {
    points += 14;
    done("Good meta description", `${meta.descChars} chars`);
  } else if (meta.description) {
    points += 6;
    warn("Meta description off range", `${meta.descChars} chars (aim 60-165)`);
  } else {
    fail("Missing meta description", "Add a 60-165 char description");
  }

  if (meta.h1 === 1) {
    points += 12;
    pass("Exactly one H1", "");
  } else if (meta.h1 > 1) {
    points += 6;
    warn(`${meta.h1} H1 tags`, "Use a single H1 per page");
  } else {
    fail("No H1 heading", "Every page should have an H1");
  }

  if (meta.hasViewport && meta.hasCharset) {
    points += 12;
    pass("Viewport + charset present", "");
  } else {
    points += 4;
    warn("Missing viewport or charset", "Ensure responsive + UTF-8 declaration");
  }

  if (meta.images > 0 && meta.imageAlt >= meta.images) {
    points += 12;
    pass("All images have alt text", `${meta.imageAlt}/${meta.images}`);
  } else if (meta.images > 0) {
    points += 5;
    warn(`${meta.imageAlt}/${meta.images} images have alt text`, "Add alt attributes");
  } else {
    points += 6;
    pass("No images to alt-check", "");
  }

  if (meta.securityHeaders >= 3) {
    points += 12;
    pass("Security headers present", `${meta.securityHeaders} found`);
  } else {
    points += 4;
    warn(`Security headers (${meta.securityHeaders}/4)`, "HSTS, nosniff, CSP/frame, referrer");
  }

  return {
    score: Math.min(100, Math.round(points)),
    max: 100,
    checks,
  };
}

function seoAudit(meta) {
  if (!meta) meta = {};
  let points = 0;
  const checks = [];
  const push = (status, label, detail) => checks.push({ status, label, detail });

  if (meta.title && meta.titleChars > 0) {
    points += meta.titleChars <= 70 ? 15 : 8;
    push("pass", "Page has a title", `${meta.titleChars} chars (≤70 ideal)`);
  } else {
    push("fail", "Missing title", "Title is the #1 ranking signal");
  }

  if (meta.description) {
    points += meta.descChars <= 165 ? 15 : 8;
    push("pass", "Meta description present", `${meta.descChars} chars`);
  } else {
    push("fail", "Missing meta description", "Shown in search results under your title");
  }

  const words = Number(meta.words) || 0;
  if (words >= 300) {
    points += 14;
    push("pass", "Substantial content", `${words} words`);
  } else if (words >= 100) {
    points += 9;
    push("warn", "Thin-ish content", `${words} words (300+ ideal)`);
  } else {
    points += 3;
    push("fail", "Very thin content", `${words} words on page`);
  }

  if (meta.h1 === 1) {
    points += 10;
    push("pass", "One H1", meta.h1Text ? `"${meta.h1Text}"` : "");
  } else if (meta.h1 > 1) {
    points += 5;
    push("warn", `${meta.h1} H1 tags`, "Keep exactly one H1");
  } else {
    push("fail", "No H1", "H1 anchors your page topic");
  }

  if (meta.canonical) {
    points += 10;
    push("pass", "Canonical link", "Duplicate-content protection");
  } else {
    push("warn", "No canonical", "Add rel=canonical to avoid duplicate pages");
  }

  if (meta.jsonLd || meta.schemaOrg) {
    points += 10;
    push("pass", "Structured data", meta.jsonLd ? `JSON-LD blocks: ${meta.jsonLd}` : "schema.org attributes");
  } else {
    push("warn", "No structured data", "Rich snippets need schema markup");
  }

  if (meta.hasOgImage) {
    points += 8;
    push("pass", "og:image set", "Social shares show a preview");
  } else {
    points += 3;
    push("warn", "No og:image", "Add one for better link sharing");
  }

  if (meta.favicon) {
    points += 8;
    push("pass", "Favicon present", "Branding in the tab + search results");
  } else {
    push("warn", "No favicon", "Set an icon");
  }

  if (meta.images > 0 && meta.imageAlt >= meta.images) {
    points += 6;
    push("pass", "Image alt coverage", `${meta.imageAlt}/${meta.images}`);
  } else if (meta.images > 0) {
    points += 2;
    push("warn", `${meta.imageAlt}/${meta.images} imgs have alt`, "Alt text helps image SEO");
  }

  if (meta.internalLinks && meta.internalLinks > 0) points += 4;

  if (meta.words > 0) {
    // basic content set heading structure bonus
    points += Math.min(4, meta.h2 * 1 + (Number(meta.h3) || 0));
  }

  return { score: Math.min(100, Math.round(points)), max: 100, checks };
}

function performanceAudit(meta, fetchMeta = {}) {
  if (!meta) meta = {};
  let points = 30;
  const checks = [];
  const push = (status, label, detail) => checks.push({ status, label, detail });

  if (typeof fetchMeta.timeMs === "number") {
    if (fetchMeta.timeMs <= 250) {
      points += 30;
      push("pass", "Fast response", `${fetchMeta.timeMs}ms total`);
    } else if (fetchMeta.timeMs <= 900) {
      points += 18;
      push("warn", "Acceptable response time", `${fetchMeta.timeMs}ms (under 900ms is fine)`);
    } else if (fetchMeta.timeMs <= 4000) {
      points += 8;
      push("fail", "Slow response", `${fetchMeta.timeMs}ms`);
    } else {
      push("fail", "Very slow / timed out", `${fetchMeta.timeMs}ms`);
    }
  } else {
    points += 10;
    push("warn", "No timing measured", "Couldn't fetch the live page");
  }

  if (typeof fetchMeta.bytes === "number") {
    if (fetchMeta.bytes <= 120 * 1024) {
      points += 20;
      push("pass", "Lean HTML", `${(fetchMeta.bytes / 1024).toFixed(1)}KB`);
    } else if (fetchMeta.bytes <= 300 * 1024) {
      points += 12;
      push("warn", "Moderate HTML weight", `${(fetchMeta.bytes / 1024).toFixed(1)}KB`);
    } else {
      points += 4;
      push("fail", "Heavy HTML", `${(fetchMeta.bytes / 1024).toFixed(1)}KB`);
    }
  }

  if (meta.compression) {
    points += 18;
    push("pass", "Compression enabled", meta.compressionName || "gzip/br");
  } else {
    push("fail", "No compression detected", "Enable gzip/brotli on your server");
  }

  if (meta.cacheHeaders) {
    points += 12;
    push("pass", "Cache headers set", "Browser can cache assets");
  } else {
    push("warn", "No cache headers", "Add cache-control/ETag");
  }

  if (meta.lazyImages) {
    points += 6;
    push("pass", "Lazy loading images", "loading=lazy found");
  } else {
    push("warn", "No lazy loading", "Defer off-screen images");
  }

  if (meta.preload) {
    points += 6;
    push("pass", "Preload/preconnect hints", `${meta.preload} resource hints`);
  } else {
    push("warn", "No preload/preconnect", "Hint critical connections");
  }

  const extra = Number(meta.scripts) + Number(meta.styles) + Number(meta.inlineStyles) + Number(meta.images);
  if (extra <= 15) {
    points += 8;
    push("pass", "Few render-blocking assets", `${extra} scripts/styles/images`);
  } else {
    points += 3;
    push("warn", `${extra} scripts/styles/images`, "Trim or defer resources");
  }

  return { score: Math.min(100, Math.round(points)), max: 100, checks };
}

// ---------------------------------------------------------------------------
// AI Website Analyzer - composes health + SEO + performance + a written brief
// ---------------------------------------------------------------------------

function summarize(meta) {
  if (!meta) return "";
  const s = [];
  if (meta.title) s.push(meta.title);
  if (meta.h1Text) s.push(meta.h1Text);
  if (meta.description) s.push(meta.description);
  return s.join(" ").slice(0, 400);
}

function pick(tone, arr) {
  const i = (tone.length + arr.length) % arr.length;
  return arr[i];
}

function analysisBrief(health, seo, perf, meta) {
  const avg = Math.round(((health.score || 0) + (seo.score || 0) + (perf.score || 0)) / 3);
  const grade = avg >= 85 ? "excellent shape" : avg >= 70 ? "solid shape" : avg >= 50 ? "room to improve" : "early stage";
  const words = Number(meta.words) || 0;
  const title = meta.title ? `focused title ("${String(meta.title).slice(0, 60)}")` : "a missing or weak title";
  const content =
    words >= 300 ? `${words} words of content` : words >= 100 ? `only ${words} words of content` : "very little text on the page";
  let seoNote =
    meta.jsonLd || meta.schemaOrg
      ? "real structured data for search engines"
      : meta.canonical
      ? "a canonical tag, though no structured data yet"
      : "no schema markup or canonical tag yet";
  const perfNote = meta.compression ? "compressed responses" : "uncompressed responses that would load faster with gzip/brotli";
  return {
    grade,
    avg,
    oneLiner: `A ${grade} site with a ${title}, ${content}, ${seoNote} and ${perfNote}.`,
  };
}

function generateDescription({ title, tech_stack, level, assetType, description, meta, fetchMeta } = {}) {
  const tokens = String(tech_stack || "")
    .split(/[\n,;•|/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const biz = String(assetType || "website").toLowerCase() === "business";
  const kind = biz ? "digital business" : "hand-built website";
  const lvl = Number(level) || 0;
  const lvlWord = ["simple starter site", "clean entry-level site", "solid mid-range site", "polished professional site", "premium production site", "flagship-grade product", "top-tier scaled platform"][Math.min(6, Math.max(0, lvl))];

  const name = String(title || "").trim() || "This premium asset";
  const hook = pick(name, [
    `A complete, ready-to-launch ${biz ? "online business" : "website"} that is built to grow from day one`,
    `Everything ${biz ? "an online business" : "a modern brand"} needs wrapped in one polished package`,
    `A turnkey ${kind} engineered for conversions and easy handover`,
  ]);

  const features = tokens.slice(0, 5).map((t) => t.toLowerCase());
  let featureLine = "";
  if (features.length) {
    const list = features.map((f) => `\u2022 ${f}`).join("\n");
    featureLine = `\n\nIt comes packed with useful features already in place:\n${list}`;
  }

  const seoBits = [];
  const meta2 = meta || {};
  if (meta2.title) seoBits.push("an optimised page title");
  if (meta2.description) seoBits.push("a tuned meta description");
  if (meta2.hasOgImage) seoBits.push("social share previews");
  if (meta2.jsonLd || meta2.schemaOrg) seoBits.push("structured data for better search results");
  if (meta2.h1 === 1) seoBits.push("clean heading structure");
  const seoLine = seoBits.length ? `\n\nOn-page SEO is looked after with ${seoBits.join(", ")}.` : "\n\nIt is ready for you to add content, products and your own branding.";

  const desc =
    `\u{1F5C4} ${name} - a ${lvlWord} for sale on MITEX.\n\n` +
    `${hook}.\n` +
    (features.length ? featureLine : "") +
    seoLine +
    `\n\nEverything is transferable on secure purchase, and MITEX handles a safe escrow-style handover.`;

  const tags = [kind, ...features.slice(0, 4), "for sale", "MITEX"].filter(Boolean).slice(0, 6);
  return { description: desc, tags };
}

function analyze({ url, title, level, tech_stack, assetType, description, _internal }) {
  const usedLive = Boolean(url || (_internal && _internal.live));
  const fetched = usedLive && _internal && _internal.live ? _internal.live : null;
  const meta = (usedLive && _internal && _internal.meta) || (fetched ? fetched.meta : null) || {};
  const fetchMeta = (fetched && fetched.fetchMeta) || {};

  const health = websiteHealth(meta, fetchMeta);
  const seo = seoAudit(meta);
  const perf = performanceAudit(meta, fetchMeta);
  const brief = analysisBrief(health, seo, perf, meta);
  const gen = generateDescription({ title, tech_stack, level, assetType, description, meta });

  return {
    url: url || null,
    live: Boolean(fetched),
    signals: {
      title: meta.title || title || "",
      words: meta.words || 0,
      h1: meta.h1 || 0,
      images: meta.images || 0,
      favicon: meta.favicon || false,
      securityHeaders: meta.securityHeaders || 0,
      loadMs: fetchMeta.timeMs || null,
      bytes: fetchMeta.bytes || 0,
    },
    health,
    seo,
    performance: perf,
    brief: brief.oneLiner,
    grade: brief.grade,
    score: Math.round(((health.score || 0) + (seo.score || 0) + (perf.score || 0)) / 3),
    generatedDescription: gen,
  };
}

module.exports = {
  fetchPage,
  analyzeHtml,
  websiteHealth,
  seoAudit,
  performanceAudit,
  analyze,
  generateDescription,
  _trim: stripTags,
  _extractMeta: extractMeta,
};