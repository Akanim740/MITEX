// Crawler-facing routes that must not come from the static file server:
// robots.txt, sitemap.xml and server-rendered listing pages.
//
// These are registered before express.static so the dynamic handlers win.
// All rendered listing content is escaped in utils/seo.js; nothing here
// interpolates raw listing text into markup.

const express = require("express");
const path = require("path");
const fs = require("fs");

const seo = require("../utils/seo");
const { assetTypeOf, protectedOf } = require("../utils/listing-metrics");
const { categoryOf, categoryLabel, normalizeCategory } = require("../utils/categories");

const router = express.Router();

const SITE_NAME = "MITEX";
const PHONE = "+234 7011633770";
const DEFAULT_OG = "/icons/icon-512.png";

// Pages worth indexing. Anything not listed here is either private (noindex is
// set in the page's own meta) or too thin to be worth a crawl budget slot.
const STATIC_SITEMAP = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/marketplace.html", priority: "0.9", changefreq: "daily" },
  { path: "/packages.html", priority: "0.8", changefreq: "monthly" },
  { path: "/transfer.html", priority: "0.7", changefreq: "monthly" },
  { path: "/valuator.html", priority: "0.7", changefreq: "monthly" },
  { path: "/careers.html", priority: "0.5", changefreq: "weekly" },
  // login.html and register.html are deliberately absent: both carry
  // noindex, and listing a noindex URL in a sitemap is a conflicting signal.
];

// Kept out of the sitemap but not blocked, so crawlers can still see the
// noindex and drop them from the index faster.
const DISALLOW = [
  "/api/",
  "/dashboard.html",
  "/account.html",
  "/worker.html",
  "/mailbox.html",
  "/onboard.html",
  "/checkout-demo.html",
  "/payment-success.html",
  "/reset-password.html",
  "/admin",
  "/.well-known",
];

// Public sitemap must not reveal private account URLs at all.
function sitemapRobots() {
  const lines = ["User-agent: *"];
  for (const path of DISALLOW) lines.push(`Disallow: ${path}`);
  lines.push("Allow: /", "Allow: /listing/");
  lines.push("");
  lines.push(`Sitemap: ${seo.abs("/sitemap.xml")}`);
  lines.push("");
  return lines.join("\n");
}

router.get("/robots.txt", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(sitemapRobots());
});

function urlEntry(loc, { priority, changefreq, lastmod }) {
  const attrs = [`    <loc>${seo.esc(loc)}</loc>`];
  if (lastmod) attrs.push(`    <lastmod>${seo.esc(lastmod)}</lastmod>`);
  if (changefreq) attrs.push(`    <changefreq>${seo.esc(changefreq)}</changefreq>`);
  if (priority) attrs.push(`    <priority>${seo.esc(priority)}</priority>`);
  return `  <url>\n${attrs.join("\n")}\n  </url>`;
}

// ISO date (YYYY-MM-DD) or nothing. Never invent a date: a wrong lastmod is
// worse than an absent one because crawlers stop trusting the whole tag.
function lastmodOf(row) {
  const raw = row && (row.updated_at || row.created_at);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Sitemap generation must never take the site down: a DB blip has to degrade
// to the static pages, not a 500 that tells crawlers the site is broken.
async function publicListings(store) {
  const rows = await store.listings.list({ includeSold: false });
  return rows.map((row) => ({
    ...row,
    assetType: assetTypeOf(row),
    protected: protectedOf(row),
    category: categoryOf(row),
    categoryLabel: categoryLabel(categoryOf(row)),
  }));
}

router.get("/sitemap.xml", async (req, res) => {
  const base = seo.origin();
  const urls = [];
  for (const entry of STATIC_SITEMAP) {
    urls.push(urlEntry(base + entry.path, entry));
  }
  try {
    const listings = await publicListings(req.store);
    for (const listing of listings) {
      urls.push(
        urlEntry(seo.listingUrl(listing), {
          priority: "0.8",
          changefreq: "weekly",
          lastmod: lastmodOf(listing),
        })
      );
    }
  } catch (err) {
    console.error("sitemap: listings unavailable, serving static pages only:", err.message);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  res
    .type("application/xml")
    .set("Cache-Control", "public, max-age=900")
    .send(xml);
});

// --- Domain-agnostic static HTML ---------------------------------------
//
// Every page hardcodes its own canonical/og:url. If the site later moves to a
// custom domain those tags keep pointing at the old host, and self-canonicals
// to the wrong origin get the pages dropped from the index. Static files
// cannot read env vars, so they carry an __ORIGIN__ placeholder and
// serveStaticHtml (registered last, below) substitutes the configured origin.

// --- Server-rendered marketplace ---------------------------------------
//
// The grid is normally painted by auth.js from /api/listings, so a crawler
// that does not run JS sees an empty <div>. Injecting the first page of
// results into the shell gives crawlers the inventory and real text while
// auth.js still takes over on the client (it re-renders over the top).

const MARKET_PAGE_SIZE = 8;
const marketplaceLayoutPath = path.join(__dirname, "..", "..", "marketplace.html");

function nairaMarkup(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `&#8358;${Math.round(n).toLocaleString("en-NG")}`;
}

// Markup mirrors renderListings() in auth.js so the swap is visually seamless.
function renderCard(listing) {
  const chips = [
    listing.level ? `<span class="chip gold">Level ${seo.esc(listing.level)}</span>` : "",
    `<span class="chip">${seo.esc(listing.categoryLabel || categoryLabel(listing.category))}</span>`,
    listing.assetType === "business" ? `<span class="chip">Digital Business</span>` : "",
    `<span class="chip">${seo.esc(listing.status === "available" ? "Available" : "Sold")}</span>`,
    listing.protected === false ? "" : `<span class="chip shield">Protected</span>`,
    typeof listing.score === "number" ? `<span class="chip score">${seo.esc(listing.score)}/100</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const tech = listing.tech_stack
    ? `<div class="tech-row">${String(listing.tech_stack)
        .split(",")
        .map((t) => `<span class="chip">${seo.esc(t.trim())}</span>`)
        .join("")}</div>`
    : "";
  const trust =
    typeof listing.trustScore === "number"
      ? `<div class="trust-row">Seller ${seo.esc(listing.trustScore)}/100 &middot; <span>${seo.esc(listing.trustLabel || "")}</span></div>`
      : "";
  const image = listing.thumbnail
    ? `<a href="${seo.esc(seo.listingPath(listing))}" tabindex="-1" aria-hidden="true"><img src="${seo.esc(listing.thumbnail)}" alt="" width="640" height="400" loading="lazy" decoding="async" style="width:100%;height:auto;border-radius:12px;margin-bottom:14px;" /></a>`
    : "";
  return `        <article class="listing-card">
          ${image}
          <div class="chips" style="justify-content:flex-start;">
            ${chips}
          </div>
          <h3><a href="${seo.esc(seo.listingPath(listing))}" style="color:inherit;text-decoration:none;">${seo.esc(listing.title)}</a></h3>
          <p>${seo.esc(listing.description)}</p>
          ${tech}
          <div class="price">${nairaMarkup(listing.price)}</div>
          ${trust}
          <a class="btn btn-ghost btn-full" href="${seo.esc(seo.listingPath(listing))}" style="margin-top:8px;">View details</a>
        </article>`;
}

router.get("/marketplace.html", async (req, res, next) => {
  try {
    const layout = await fs.promises.readFile(marketplaceLayoutPath, "utf8");
    // Placeholder in marketplace.html: <div class="listing-grid" id="listingsGrid"><!--SSR_LISTINGS--></div>
    if (!layout.includes("<!--SSR_LISTINGS-->")) return next();

    const all = await publicListings(req.store);

    // Honour ?category= server-side. The category chips are a client-side
    // filter, so without this a crawler landing on a category URL (from the
    // listing-page breadcrumb, a shared link, or a search engine) would be
    // served the unfiltered first page and the breadcrumb would point at
    // nothing. An unknown slug falls through to the full catalogue rather than
    // 400-ing a public browse page.
    const wanted = req.query.category ? normalizeCategory(req.query.category) : null;
    const listings = wanted ? all.filter((l) => l.category === wanted) : all;

    const { websiteScore, sellerTrust } = require("../utils/listing-metrics");
    const page = listings.slice(0, MARKET_PAGE_SIZE).map((listing) => {
      const score = websiteScore(listing);
      const trust = sellerTrust({ paid: 0, delivered: listing.delivery_url ? 1 : 0 });
      return {
        ...listing,
        score: score.score,
        scoreLabel: score.label,
        trustScore: trust.score,
        trustLabel: trust.label,
      };
    });
    const cards = page.map(renderCard).join("\n");
    const jsonLd = `  <script type="application/ld+json">\n  ${seo.jsonLd(seo.itemListLd(listings.slice(0, 20)))}\n  </script>\n`;
    const html = layout
      .replace("<!--SSR_LISTINGS-->", cards)
      .replace("<!--SEO_HEAD-->", jsonLd)
      // The client owns filtering and pagination; without JS the static
      // "View details" links remain fully usable.
      .replace(/<script src="auth\.js"><\/script>/, '<script src="auth.js"></script>');
    res.type("html").set("Cache-Control", "public, max-age=300").send(html);
  } catch (err) {
    // Never let a listing outage take the marketplace down: fall back to the
    // static shell, which still renders client-side.
    next();
  }
});

// --- Server-rendered listing detail pages -------------------------------
//
// Before this, listings existed only as JS-rendered cards inside
// marketplace.html: one indexable URL for the whole catalogue and no
// per-product content. Each listing now gets a real page with Product/Offer
// markup, a self-canonical URL and a matching entry in the sitemap.

const layoutPath = path.join(__dirname, "..", "..", "listing.html");

function readLayout() {
  return fs.readFileSync(layoutPath, "utf8");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The static shell carries placeholder tokens rather than real listing data,
// so nothing untrusted is ever written to disk.
function renderListing(layout, listing) {
  const title = seo.titleFor(listing);
  const description = seo.descriptionFor(listing);
  const url = seo.listingPath(listing);
  const price = seo.nairaPlain(listing.price);
  const image = listing.thumbnail || DEFAULT_OG;
  const available = String(listing.status) === "available";
  const category = categoryOf(listing);
  const categoryName = listing.categoryLabel || categoryLabel(category);
  const tech = String(listing.tech_stack || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const head = [
    seo.metaBlock({ title, description, url, image, type: "product" }),
    `  <script type="application/ld+json">\n  ${seo.jsonLd(seo.productLd(listing))}\n  </script>`,
    `  <script type="application/ld+json">\n  ${seo.jsonLd(
      seo.breadcrumbLd([
        { name: "Home", url: seo.abs("/") },
        { name: "Marketplace", url: seo.abs("/marketplace.html") },
        { name: categoryName, url: `${seo.abs("/marketplace.html")}?category=${encodeURIComponent(category)}` },
        { name: listing.title, url: seo.listingUrl(listing) },
      ])
    )}\n  </script>`,
  ].join("\n");

  const facts = [
    ["Category", categoryName],
    ["Asset type", listing.assetType === "business" ? "Digital Business" : "Website"],
    ["Level", listing.level ? `Level ${listing.level}` : "Standard"],
    ["Protection", listing.protected === false ? "Buyer protection applies" : "MITEZ protected"],
    ["Live demo", listing.demo_url ? "Available" : "Not provided for this listing"],
    ["Status", available ? "Available now" : "Sold"],
  ];
  if (typeof listing.score === "number") {
    facts.push(["Website score", `${listing.score}/${listing.scoreMax || 100} (${listing.scoreLabel || "rated"})`]);
  }
  if (typeof listing.trustScore === "number") {
    facts.push(["Seller trust", `${listing.trustScore}/${listing.trustMax || 100} (${listing.trustLabel || "rated"})`]);
  }

  const body = [
    `<section class="ld-hero">`,
    listing.thumbnail
      ? `  <img class="ld-shot" src="${seo.esc(seo.abs(listing.thumbnail))}" alt="${seo.esc(listing.title)}" width="640" height="400" loading="eager" decoding="async" />`
      : "",
    `  <h1>${seo.esc(listing.title)}</h1>`,
    `  <p class="ld-price">${seo.esc(price || "Price on request")}</p>`,
    `  <p class="ld-lede">${seo.esc(description)}</p>`,
    `  <a class="btn btn-primary ld-cta" href="/marketplace.html?listing=${seo.esc(String(listing.id))}">${available ? "Buy this website" : "View similar websites"}</a>`,
    `</section>`,
    `<section class="ld-desc">`,
    `  <h2>About this ${seo.esc(categoryName.toLowerCase())} ${listing.assetType === "business" ? "digital business" : "website"}</h2>`,
    `  <p>${seo.esc(String(listing.description || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br />"))}</p>`,
    `</section>`,
    tech.length
      ? `<section class="ld-tech"><h2>Built with</h2><ul>${tech.map((t) => `<li>${seo.esc(t)}</li>`).join("")}</ul></section>`
      : "",
    // "What you receive" is derived from real listing fields so the page cannot
    // drift into promising delivery terms MITEX does not control.
    `<section class="ld-desc"><h2>What you receive</h2><ul>` +
      `<li>${
        listing.demo_url
          ? "A live demo you can review before you buy"
          : "The complete website source files, assets and setup instructions"
      }</li>` +
      `<li>${
        listing.protected === false
          ? "Purchase handled directly with the seller"
          : "Protected purchase: payment is released on confirmed delivery"
      }</li>` +
      `<li>Support through the handover and any post-delivery fixes agreed at purchase</li>` +
      `</ul></section>`,
    `<section class="ld-facts"><h2>Listing details</h2><dl>${facts
      .map(([k, v]) => `<dt>${seo.esc(k)}</dt><dd>${seo.esc(v)}</dd>`)
      .join("")}</dl></section>`,
  ]
    .filter(Boolean)
    .join("\n");

  // Any canonical/og:url baked into the shell describes the *template*, not
  // this listing, so strip them before ours lands. Doing this after the
  // placeholder substitution keeps the shell free of duplicate tags.
  const shell = layout
    .replace(/<link rel="canonical"[^>]*\/?>\s*/g, "")
    .replace(/<meta property="og:url"[^>]*\/?>\s*/g, "")
    .replace(/<meta property="og:image"[^>]*\/?>\s*/g, "")
    .replace(/<meta name="description"[^>]*\/?>\s*/g, "")
    // A rendered listing is a real page and must be indexable, so drop the
    // template's noindex rather than inheriting it.
    .replace(/<meta name="robots" content="noindex,nofollow"\s*\/?>\s*/g, "");

  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${seo.esc(title)}</title>`)
    .replace("<!--SEO_HEAD-->", head)
    .replace("<!--SEO_BODY-->", body);
}

router.get("/listing/:slug", async (req, res, next) => {
  const id = seo.parseListingSlug(req.params.slug);
  if (!id) return next();
  try {
    const row = await req.store.listings.get(id);
    if (!row) {
      // A deleted listing must 404 with the real 404 page, not a soft 200.
      return next();
    }
    if (String(row.status) !== "available") {
      // Sold items stay reachable but must not compete for catalogue queries.
      res.set("X-Robots-Tag", "noindex, follow");
    }
    const listing = {
      ...row,
      assetType: assetTypeOf(row),
      protected: protectedOf(row),
      category: categoryOf(row),
      categoryLabel: categoryLabel(categoryOf(row)),
    };
    // Mirrors the decorate() enrichment in routes/listings.js for scores.
    const { websiteScore, sellerTrust } = require("../utils/listing-metrics");
    const score = websiteScore(row);
    listing.score = score.score;
    listing.scoreLabel = score.label;
    listing.scoreMax = score.max;
    const trust = sellerTrust({ paid: 0, delivered: row.delivery_url ? 1 : 0 });
    listing.trustScore = trust.score;
    listing.trustLabel = trust.label;
    listing.trustMax = trust.max;

    const html = renderListing(readLayout(), listing);
    res
      .type("html")
      // Personalized per-listing HTML must not be cached by shared proxies.
      .set("Cache-Control", "public, max-age=300")
      .send(html);
  } catch (err) {
    next(err);
  }
});

// Registered last so /marketplace.html and /listing/* (which also match the
// generic .html pattern) keep their server-rendered handlers.
const ORIGIN_TOKEN = "__ORIGIN__";
const publicRoot = path.join(__dirname, "..", "..");

function serveStaticHtml(req, res, next) {
  const match = /^\/([A-Za-z0-9._-]+\.html)$/.exec(req.path);
  if (!match) return next();
  const file = path.join(publicRoot, match[1]);
  // Belt-and-braces against traversal: the resolved parent must be the root.
  if (path.dirname(file) !== publicRoot) return next();
  fs.readFile(file, "utf8", (err, html) => {
    if (err) return next();
    res
      .type("html")
      .set("Cache-Control", "public, max-age=300")
      .send(html.split(ORIGIN_TOKEN).join(seo.origin()));
  });
}

router.get("/*.html", serveStaticHtml);

// "/" is what crawlers and visitors actually request, and it does not match the
// *.html pattern above, so express.static would serve index.html verbatim with
// an unresolved __ORIGIN__ token (broken canonical, og:url and sitemap link).
// Read the same file through the origin substitution instead.
router.get("/", (req, res, next) => {
  fs.readFile(path.join(publicRoot, "index.html"), "utf8", (err, html) => {
    if (err) return next();
    res
      .type("html")
      .set("Cache-Control", "public, max-age=300")
      .send(html.split(ORIGIN_TOKEN).join(seo.origin()));
  });
});

module.exports = router;
module.exports.serveStaticHtml = serveStaticHtml;
module.exports.ORIGIN_TOKEN = ORIGIN_TOKEN;
module.exports.sitemapRobots = sitemapRobots;
module.exports.STATIC_SITEMAP = STATIC_SITEMAP;
module.exports.DISALLOW = DISALLOW;
// Exported for scripts/seo-xss-check.js so escaping can be asserted without
// provisioning an admin account.
module.exports.renderListing = renderListing;
module.exports.renderCard = renderCard;
module.exports.publicListings = publicListings;
module.exports.lastmodOf = lastmodOf;
module.exports.MARKET_PAGE_SIZE = MARKET_PAGE_SIZE;