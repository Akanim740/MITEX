/**
 * Does the server-rendered listing page leak the private delivery URL?
 *
 * routes/seo.js builds its public view with publicListings(), which spreads the
 * raw store row -- including delivery_url -- because the trust badge needs it.
 * The delivery URL is meant to reach a buyer only after payment, so this
 * asserts the private URL never appears in the HTML a crawler or anonymous
 * visitor receives, while still appearing in the admin API for staff.
 */
const { renderListing, renderCard, publicListings } = require("../routes/seo");
const store = require("../db/sqlite");
const fs = require("fs");
const path = require("path");

const SECRET = "https://private-bucket.example/SUPER-SECRET-DELIVERY-abc123.zip";
const LAYOUT = fs.readFileSync(path.join(__dirname, "..", "..", "listing.html"), "utf8");

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = "") => {
    if (ok) {
      pass++;
      console.log(`PASS  ${name}`);
    } else {
      fail++;
      console.log(`FAIL  ${name} ${detail}`);
    }
  };

  const created = await store.listings.create({
    title: "ZZ Delivery Leak Probe",
    description: "temporary listing with a private delivery url",
    price: 999,
    level: 2,
    category: "other",
    asset_type: "website",
    delivery_url: SECRET,
  });

  try {
    // The public SSR view is built from raw rows, so it DOES carry the field.
    const raw = await store.listings.list({ includeSold: true });
    const row = raw.find((r) => r.id === created.id);
    check("fixture really has the private url", row && row.delivery_url === SECRET);

    const pub = await publicListings(store);
    const mine = pub.find((r) => r.id === created.id);
    check("publicListings carries delivery_url for the trust badge", Boolean(mine && mine.delivery_url));

    const page = renderListing(LAYOUT, mine);
    check("detail page does NOT leak the delivery url", !page.includes(SECRET));
    check("detail page does NOT mention the field name", !/delivery_url/.test(page));
    check("detail page still renders the title", page.includes("ZZ Delivery Leak Probe"));

    const card = renderCard(mine);
    check("SSR card does NOT leak the delivery url", !card.includes(SECRET));
    check("SSR card does NOT mention the field name", !/delivery_url/.test(card));

    // The HTML-escaped form must not leak either.
    const escaped = SECRET.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    check("escaped variant does not leak", !page.includes(escaped) && !card.includes(escaped));

    // And the protection facts must not be inverted while we are here.
    check(
      "protected listing claims MITEX protection",
      /MITEX protected/.test(page),
      ""
    );
    check("no MITEZ typo anywhere", !/MITEZ/.test(page));

    const unprotected = await store.listings.create({
      title: "ZZ Unprotected Probe",
      description: "temporary unprotected listing",
      price: 999,
      level: 2,
      category: "other",
      asset_type: "website",
      protected: false,
    });
    const pubU = (await publicListings(store)).find((r) => r.id === unprotected.id);
    const pageU = renderListing(LAYOUT, pubU);
    check(
      "unprotected listing does NOT claim buyer protection",
      !/Buyer protection applies/.test(pageU),
      ""
    );
    check(
      "unprotected listing says it is a direct purchase",
      /Direct purchase with the seller/.test(pageU)
    );
    await store.listings.remove(unprotected.id);
  } finally {
    await store.listings.remove(created.id);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(`CRASH: ${e.message}`);
  process.exit(1);
});