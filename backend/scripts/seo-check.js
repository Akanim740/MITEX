// End-to-end checks for the server-rendered SEO surface.
// Run with the dev server already listening: node scripts/seo-check.js
const BASE = process.env.SEO_TEST_BASE || "http://localhost:3000";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

(async () => {
  // robots.txt
  const robots = await get("/robots.txt");
  check("robots 200", robots.status === 200, String(robots.status));
  check("robots has Sitemap", /Sitemap:\s*https?:\/\//.test(robots.body));
  check("robots blocks /api/", robots.body.includes("Disallow: /api/"));
  check("robots allows /listing/", robots.body.includes("Allow: /listing/"));
  check("robots blocks mailbox", robots.body.includes("Disallow: /mailbox.html"));
  check("robots blocks payment-success", robots.body.includes("Disallow: /payment-success.html"));
  check("robots blocks reset-password", robots.body.includes("Disallow: /reset-password.html"));
  check("robots origin matches config", robots.body.includes(BASE));

  // static robots.txt must not shadow the dynamic one
  check("robots no onrender hardcode", !robots.body.includes("mitex.onrender.com"));

  // sitemap.xml
  const sm = await get("/sitemap.xml");
  check("sitemap 200", sm.status === 200, String(sm.status));
  check("sitemap xml prolog", sm.body.startsWith('<?xml version="1.0"'));
  check("sitemap urlset ns", sm.body.includes("xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\""));
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check("sitemap has home", locs.some((l) => l === BASE + "/"));
  check("sitemap has marketplace", locs.some((l) => l.endsWith("/marketplace.html")));
  check("sitemap has listing urls", locs.some((l) => l.includes("/listing/")));
  check("sitemap no index.html dup", !locs.some((l) => l.endsWith("/index.html")));
  check("sitemap no private pages", !locs.some((l) => /dashboard\.html|account\.html|worker\.html|mailbox\.html|checkout-demo\.html|payment-success\.html|reset-password\.html/.test(l)));
  check("sitemap no api urls", !locs.some((l) => l.includes("/api/")));
  check("sitemap no hardcoded render host", !sm.body.includes("mitex.onrender.com"));

  // marketplace server-rendered inventory
  const mk = await get("/marketplace.html");
  check("marketplace 200", mk.status === 200, String(mk.status));
  check("marketplace cards rendered", /<article class="listing-card">/.test(mk.body));
  check("marketplace placeholder replaced", !mk.body.includes("<!--SSR_LISTINGS-->"));
  check("marketplace ItemList ld", mk.body.includes("ItemList"));
  check("marketplace has canonical", /<link rel="canonical"/.test(mk.body));
  check("marketplace links listing pages", /href="\/listing\//.test(mk.body));
  check("marketplace no leaked payload", !mk.body.includes("undefined"));

  // listing detail page
  // Static pages must resolve __ORIGIN__ from config, never a baked-in host.
  for (const p of ["/", "/packages.html", "/privacy.html", "/terms.html", "/valuator.html", "/transfer.html", "/careers.html", "/client-pitch.html", "/refund.html"]) {
    const page = await get(p === "/" ? "/index.html" : p);
    check(`${p} 200`, page.status === 200, String(page.status));
    check(`${p} no unresolved placeholder`, !page.body.includes("__ORIGIN__"));
    check(`${p} no baked render host`, !page.body.includes("mitex.onrender.com"));
    const canon = /<link rel="canonical" href="([^"]+)"/.exec(page.body);
    check(`${p} has canonical`, Boolean(canon));
    check(`${p} canonical on configured origin`, Boolean(canon) && canon[1].startsWith(BASE), canon && canon[1]);
    check(`${p} has description`, /<meta name="description"/.test(page.body));
  }

  // Privacy terms must not leak a stale host in body copy either.
  const terms = await get("/terms.html");
  check("terms.html no baked host in copy", !terms.body.includes("mitex.onrender.com"));

  // noindex must appear exactly once per private page
  for (const p of ["/dashboard.html", "/account.html", "/worker.html", "/mailbox.html", "/onboard.html", "/checkout-demo.html", "/payment-success.html", "/reset-password.html", "/login.html", "/register.html", "/404.html"]) {
    const page = await get(p);
    const count = (page.body.match(/<meta name="robots"/g) || []).length;
    check(`${p} exactly one robots tag`, count === 1, String(count));
    check(`${p} noindex,nofollow`, /<meta name="robots" content="noindex,?\s*nofollow"/i.test(page.body));
  }

  // Private pages must not all share one boilerplate description; a unique,
// page-accurate one avoids thin-content signals on indexed pages.
  const privateDescriptions = {
    "/dashboard.html": "Seller dashboard: listings, orders and earnings.",
    "/account.html": "Manage your MITEX account, purchases and profile.",
    "/worker.html": "Staff workspace for fulfilment and listing delivery.",
    "/mailbox.html": "Your MITEX in-app message inbox.",
    "/onboard.html": "Finish setting up your MITEX account.",
    "/checkout-demo.html": "MITEX checkout.",
    "/payment-success.html": "MITEX payment confirmation.",
    "/reset-password.html": "Choose a new MITEX password.",
    "/login.html": "Sign in to your MITEX account.",
    "/register.html": "Create a MITEX account to buy premium websites.",
    "/404.html": "Page not found.",
  };
  for (const [p, expected] of Object.entries(privateDescriptions)) {
    const page = await get(p);
    const desc = /<meta name="description" content="([^"]*)"/.exec(page.body);
    check(`${p} description present`, Boolean(desc));
    check(`${p} description is page-specific`, Boolean(desc) && desc[1] === expected, desc && desc[1]);
  }

  const listId = (locs.find((l) => l.includes("/listing/")) || "").match(/\/listing\/(\d+)/);
  if (!listId) {
    check("a listing exists to test", false, "no /listing/ URL in sitemap");
  } else {
    const id = listId[1];
    const detail = await get(`/listing/${id}-anything-at-all`);
    check("listing 200", detail.status === 200, String(detail.status));
    check("listing Product ld", detail.body.includes('"@type":"Product"'));
    check("listing Offer ld", detail.body.includes('"@type":"Offer"'));
    check("listing Breadcrumb ld", detail.body.includes('"@type":"BreadcrumbList"'));
    check("listing canonical self", detail.body.includes(`<link rel="canonical" href="${BASE}/listing/${id}-`));
    check("listing og:url", detail.body.includes('property="og:url"'));
    check("listing description", /<meta name="description"/.test(detail.body));
    check("listing h1", /<h1>/.test(detail.body));
    check("listing no placeholders", !detail.body.includes("SEO_HEAD") && !detail.body.includes("SEO_BODY"));
    check("listing no fake aggregateRating", !detail.body.includes("aggregateRating"));
    check("listing is indexable", !/<meta name="robots"[^>]*noindex/i.test(detail.body));

    // The bare template must not be indexable or expose placeholder tokens.
    const bare = await get("/listing.html");
    check("listing.html template noindex", /<meta name="robots" content="noindex,nofollow"/i.test(bare.body));
    check("listing.html template has no canonical", !/rel="canonical"/.test(bare.body));
    check("listing exactly one canonical", (detail.body.match(/rel="canonical"/g) || []).length === 1);
    check("listing exactly one title", (detail.body.match(/<title>/g) || []).length === 1);
    check("listing no undefined", !detail.body.includes("undefined"));

    // unknown listing must 404, not soft-200
    const missing = await get("/listing/999999999-nope");
    check("missing listing 404s", missing.status === 404, String(missing.status));

    // non-numeric slug falls through to normal routing
    const bogus = await get("/listing/not-an-id");
    check("bogus slug not hijacked", bogus.status === 404, String(bogus.status));
  }

  console.log(`\nseo-check: ${pass} passed, ${fail} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  // Set exitCode instead of calling process.exit(): Node's undici keep-alive
  // sockets are still closing, and an explicit exit aborts them mid-teardown,
  // which crashes the process with a UV_HANDLE_CLOSING assertion on Windows.
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error("seo-check crashed:", err);
  process.exitCode = 2;
});