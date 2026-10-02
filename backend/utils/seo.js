// Server-side SEO rendering for MITEX.
//
// The site ships as static HTML, so crawlers that do not execute JavaScript
// see empty pages: the marketplace grid is filled by auth.js from
// /api/listings, and there was no per-listing URL at all. This module renders
// that content on the server instead.
//
// Every value that reaches the output comes from the listings table, so all
// interpolation goes through esc()/jsonLd(). Never concatenate raw listing
// text into markup.

// Derives the listing's industry label for structured data and breadcrumbs.
const { categoryOf, categoryLabel } = require("./categories");

// SEO_BASE_URL wins over APP_URL so canonical URLs can be pinned to the
// marketing domain (e.g. https://mitex.store) while APP_URL still points at
// the deployment host that Paystack/Paystack webhooks already use.
function origin() {
  const raw = process.env.SEO_BASE_URL || process.env.APP_URL || "http://localhost:3000";
  return String(raw).trim().replace(/\/+$/, "");
}

// Absolute URL for a root-relative path.
function abs(path) {
  const p = String(path || "/");
  if (/^https?:\/\//i.test(p)) return p;
  return origin() + (p.startsWith("/") ? p : "/" + p);
}

// HTML text/attribute escaping. Matches auth.js esc() so server-rendered
// markup is byte-identical in shape to the client-rendered version.
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON-LD is embedded in <script type="application/ld+json">, which the HTML
// parser still reads as raw text. Listing titles/descriptions are untrusted, so
// neutralise any sequence that could close the element or break JS parsing.
function jsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
// U+2028/U+2029 are valid in JSON strings but illegal raw in JS source,
    // so escape them explicitly instead of matching the literal characters.
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function metaBlock({ title, description, url, image, type = "website", noindex = false }) {
  const canonical = abs(url);
  const img = abs(image || "/icons/icon-512.png");
  const parts = [
    `  <meta name="description" content="${esc(description)}" />`,
    `  <link rel="canonical" href="${esc(canonical)}" />`,
    `  <meta property="og:title" content="${esc(title)}" />`,
    `  <meta property="og:description" content="${esc(description)}" />`,
    `  <meta property="og:type" content="${esc(type)}" />`,
    `  <meta property="og:url" content="${esc(canonical)}" />`,
    `  <meta property="og:image" content="${esc(img)}" />`,
    `  <meta property="og:site_name" content="MITEX" />`,
    `  <meta name="twitter:card" content="summary_large_image" />`,
    `  <meta name="twitter:title" content="${esc(title)}" />`,
    `  <meta name="twitter:description" content="${esc(description)}" />`,
    `  <meta name="twitter:image" content="${esc(img)}" />`,
  ];
  if (noindex) parts.push(`  <meta name="robots" content="noindex,nofollow" />`);
  return parts.join("\n");
}

// "Buy a Premium Website in Nigeria | MITEX" style title, clamped to the
// ~60-char window Google renders before truncating.
function titleFor(listing) {
  const base = String(listing.title || "").trim();
  const trimmed = base.length > 48 ? base.slice(0, 48).replace(/[\s,;:-]+\S*$/, "").trim() : base;
  return `${trimmed || "Premium Website"} for Sale | MITEX`;
}

function descriptionFor(listing) {
  const price = nairaPlain(listing.price);
  const body = String(listing.description || "")
    .replace(/\s+/g, " ")
    .trim();
  const head = price ? `${body} ${price}.`.trim() : body;
  const suffix = " Buy securely on MITEX.";
  const room = 160 - suffix.length;
  const clipped = head.length > room ? head.slice(0, room).replace(/\s+\S*$/, "") : head;
  return (clipped + suffix).slice(0, 160);
}

// Plain-text naira for meta copy and structured data. Kept separate from the
// escaped markup form below so both stay readable.
function nairaPlain(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return "NGN " + n.toLocaleString("en-NG", { maximumFractionDigits: 0 });
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// /listing/<id>-<slug> keeps ids unique while giving crawlers readable URLs.
// The id prefix stays authoritative so a retitled listing cannot orphan its
// URL; the slug is cosmetic and the canonical reflects the current title.
function listingPath(listing) {
  const id = encodeURIComponent(String(listing.id));
  const slug = slugify(listing.title);
  return slug ? `/listing/${id}-${slug}` : `/listing/${id}`;
}

function listingUrl(listing) {
  return abs(listingPath(listing));
}

// Accepts "12" or "12-my-old-title"; the numeric prefix is the real key.
function parseListingSlug(raw) {
  const m = /^(\d+)(?:-[a-z0-9-]*)?$/i.exec(String(raw || "").trim());
  return m ? m[1] : null;
}

function breadcrumbLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// Product + Offer markup is what earns rich results for a marketplace, so it
// is emitted for every listing that has a usable price.
function productLd(listing) {
  const url = listingUrl(listing);
  const available = String(listing.status) === "available";
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: String(listing.title || "Premium Website"),
    description: String(listing.description || "").slice(0, 5000),
    url,
    sku: String(listing.id),
    // Real industry category, not the website/business split. Keeping the
    // taxonomy meaningful in structured data is what lets these pages compete
    // for the queries buyers actually type.
    category: categoryLabel(categoryOf(listing)),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "NGN",
      price: String(listing.price),
      availability: available ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      itemCondition: "https://schema.org/UsedCondition",
      seller: { "@type": "Organization", name: "MITEX" },
    },
  };
  if (listing.thumbnail) {
    product.image = [abs(listing.thumbnail)];
  }
  // Deliberately no aggregateRating: listing.score is MITEX's own quality
  // metric, not buyer reviews. Google treats rating markup without genuine
  // review data as a policy violation, so it would earn a manual action
  // instead of a rich result.
  return product;
}

function itemListLd(listings) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Premium websites for sale",
    numberOfItems: listings.length,
    itemListElement: listings.map((listing, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: listingUrl(listing),
      name: String(listing.title || ""),
    })),
  };
}

module.exports = {
  origin,
  abs,
  esc,
  jsonLd,
  metaBlock,
  titleFor,
  descriptionFor,
  nairaPlain,
  slugify,
  listingPath,
  listingUrl,
  parseListingSlug,
  breadcrumbLd,
  productLd,
  itemListLd,
};