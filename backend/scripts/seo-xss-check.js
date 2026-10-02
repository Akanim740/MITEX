// Escaping assertions for the server-rendered SEO surface.
//
// Runs the render functions directly against hostile listing text. This does
// not need an admin account or a live server, so it can run in CI and catch a
// stored-XSS regression before a listing with markup ever ships.
//
// Usage: node scripts/seo-xss-check.js
const path = require("path");
const seoRoute = require("../routes/seo");
const seo = require("../utils/seo");
const fs = require("fs");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const HOSTILE_TITLE = `XSS <img src=x onerror=alert(1)> </script><script>alert(2)</script>`;
const HOSTILE_DESC = `desc & "quotes" <b>bold</b> </script><svg onload=alert(3)>`;

const layout = fs.readFileSync(path.join(__dirname, "..", "..", "listing.html"), "utf8");

const hostile = {
  id: 7,
  title: HOSTILE_TITLE,
  description: HOSTILE_DESC,
  price: 120000,
  status: "available",
  assetType: "website",
  protected: true,
  level: 3,
  tech_stack: "React, <b>Node</b>",
  thumbnail: `https://cdn.example.com/x.png" onerror="alert(4)`,
};

const html = seoRoute.renderListing(layout, hostile);

// --- structural correctness ---
check("single title tag", (html.match(/<title>/g) || []).length === 1);
check("single canonical", (html.match(/rel="canonical"/g) || []).length === 1);
check("single og:url", (html.match(/property="og:url"/g) || []).length === 1);
check("single description", (html.match(/<meta name="description"/g) || []).length === 1);
check("no placeholders left", !html.includes("SEO_HEAD") && !html.includes("SEO_BODY"));
// A rendered listing must be indexable, so the template's noindex is stripped.
check("rendered listing drops template noindex", !/<meta name="robots"[^>]*noindex/i.test(html));
check("template itself is noindex", /<meta name="robots" content="noindex,nofollow"/i.test(layout));
check("no literal undefined", !html.includes("undefined"));
check("h1 present", /<h1>/.test(html));

// --- markup injection ---
check("no live img/onerror", !/<img src=x onerror/i.test(html));
check("no live svg onload", !/<svg onload/i.test(html));
check("no injected script element from title", (html.match(/<script/g) || []).length === (html.match(/<\/script>/g) || []).length);
check("escaped img payload", html.includes("&lt;img src=x onerror=alert(1)&gt;"));
check("escaped svg payload", html.includes("&lt;svg onload=alert(3)&gt;"));
check("escaped bold payload", html.includes("&lt;b&gt;bold&lt;/b&gt;"));
check("escaped tech stack", html.includes("&lt;b&gt;Node&lt;/b&gt;"));

// A thumbnail URL carrying a quote must not be able to add an event handler.
// The escaped text stays inside src, so assert on attribute *names*: a naive
// substring search would match the inert "onerror=&quot;" text itself.
const thumbTag = /<img class="ld-shot"[^>]*>/.exec(html);
// Walk the tag tracking quote state so " onerror=" appearing inside a quoted
// value is not mistaken for an attribute of its own.
function attributeNames(tag) {
  const names = [];
  let i = 0;
  let current = "";
  let quote = null;
  const push = () => {
    const name = current.trim().toLowerCase().replace(/^</, "").replace(/=$/, "");
    if (name) names.push(name);
  };
  while (i < tag.length) {
    const ch = tag[i];
    if (quote) {
      if (ch === quote) quote = null;
      i++;
      continue;
    }
if (ch === '"' || ch === "'") {
      push();
      current = "";
      quote = ch;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  push();
  return names;
}
const thumbAttrs = thumbTag ? attributeNames(thumbTag[0]) : [];
check("thumbnail tag rendered", Boolean(thumbTag));
check("thumbnail has no onerror attribute", !thumbAttrs.includes("onerror"), thumbAttrs.join(","));
check(
  "thumbnail has expected attrs",
  ["src", "alt", "width", "height"].every((a) => thumbAttrs.includes(a)),
  thumbAttrs.join(",")
);

// --- JSON-LD integrity ---
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check("two JSON-LD blocks", blocks.length === 2, String(blocks.length));
let parsed = 0;
for (const block of blocks) {
  try {
    JSON.parse(block.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
    parsed++;
  } catch {}
}
check("all JSON-LD parses", parsed === blocks.length, `${parsed}/${blocks.length}`);
check("JSON-LD raw text has no < or &", blocks.every((b) => !/[<&]/.test(b)));

// --- canonical/self-consistency ---
const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html);
check("canonical present", Boolean(canonical));
check("canonical is the listing url", Boolean(canonical) && canonical[1].endsWith(seo.listingPath(hostile)), canonical && canonical[1]);
check("breadcrumb ends at listing", Boolean(canonical) && html.includes(`"position":3`) && html.includes(canonical[1]));

const product = JSON.parse(blocks[0].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
check("product name preserved verbatim", product.name === HOSTILE_TITLE);
check("offer price numeric", /^\d+$/.test(product.offers.price));
check("availability InStock", product.offers.availability.endsWith("InStock"));
check("no aggregateRating", !("aggregateRating" in product));

// --- marketplace card rendering ---
const card = seoRoute.renderCard(hostile);
check("card escapes title", card.includes("&lt;img src=x onerror=alert(1)&gt;"));
check("card no live img/onerror", !/<img src=x onerror/i.test(card));
check("card links to detail page", card.includes('href="/listing/7-'));

// --- url/slug safety ---
check("path traversal rejected", seo.parseListingSlug("../../etc/passwd") === null);
check("letters rejected", seo.parseListingSlug("not-an-id") === null);
check("numeric accepted", seo.parseListingSlug("42") === "42");
check("slug tolerated", seo.parseListingSlug("42-some-title") === "42");
check("huge id tolerated", seo.parseListingSlug("99999999999999999999") !== null);
check("empty rejected", seo.parseListingSlug("") === null);

// --- sitemap escaping helper ---
const urlEntry = seoRoute.lastmodOf({ created_at: "not-a-date" });
check("bad date yields null lastmod", urlEntry === null);
check("good date yields ISO day", seoRoute.lastmodOf({ created_at: "2026-01-05T10:00:00Z" }) === "2026-01-05");
check("missing date yields null", seoRoute.lastmodOf({}) === null);

console.log(`\nseo-xss: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAIL " + f);
process.exitCode = fail ? 1 : 0;