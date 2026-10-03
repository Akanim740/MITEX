// Backfill listings.category for rows that predate the column.
//
// Why this is a script and not an automatic guess at read time: the category
// taxonomy is real, durable data that filters, breadcrumbs and Product
// structured data all read from. Deriving it on every read would make it
// impossible to correct, and would silently re-derive to a different value if
// an admin later changed the listing.
//
// Existing rows default to 'other', which is an honest answer ("we have not
// classified this"), not a claim. This script upgrades the ones it can classify
// from their own title/description text, and leaves everything ambiguous
// alone. It never guesses an industry that the text does not support, and it
// is safe to re-run: rows that already have a category are skipped.
//
//   node scripts/backfill-listing-categories.js            # dry run
//   node scripts/backfill-listing-categories.js --apply    # write
//   node scripts/backfill-listing-categories.js --recheck  # audit only, no writes
//
// Dry run is the default on purpose: this writes to production data.

require("dotenv").config();
const { getStore } = require("../db");
const { normalizeCategory, DEFAULT_CATEGORY, SLUGS } = require("../utils/categories");

const APPLY = process.argv.includes("--apply") && require.main === module;

// Order matters and is the whole design of this script: specific industries
// first, generic buckets (services / corporate / saas) last. "Booking
// Platform" and "Tour Agency" both contain generic tokens, so a list that
// tested `saas`/`corporate` early would file a hotel and a tour operator under
// the wrong category with total confidence.
//
// Each rule must be justified by text that actually appears in a listing, not
// by what the product "feels like". Tokens that are too generic to be evidence
// (api, platform, portal, business, company on their own) are deliberately
// absent.
const RULES = [
  ["real-estate", /\b(real estate|propert(?:y|ies)|realtor|letting|landlord|apartments?)\b/i],
  ["restaurant", /\b(restaurant|diner|dining|cafe|menu|order-ahead|takeaway|food delivery|chef)\b/i],
  ["healthcare", /\b(clinic|patients?|doctors?|medical|medic\w*|dental|diagnos\w*)\b/i],
  ["education", /\b(schools?|students?|courses?|curriculum|e-?learning|enrol\w*|tutors?|academy|quizzes?)\b/i],
  ["finance", /\b(fintech|bank\w*|wallet|lending?|invest\w*|accounting|crypto|kyc|insurance|trading)\b/i],
  ["blog", /\b(blog|magazine|newsletter|editorial|publishing)\b/i],
  // "showcase" was deliberately dropped from this pattern. It is a common word
// inside descriptions of unrelated products -- "sponsor showcase" on an event
// ticketing platform classified it as a portfolio, which is how it went wrong.
// "portfolio" on its own is specific enough, and LuxePort's own title carries
// it.
  ["portfolio", /\b(portfolio|resume|\bcv\b|photographer|musician|\bdj\b)\b/i],
  ["ecommerce", /\b(e-?commerce|online store|shopping cart|checkouts?|product catalog|product grid|storefront|inventory|merch store)\b/i],
  ["services", /\b(bookings?|hotel|gyms?|fitness|salons?|spas?|tours?|travel|dealership|test-?drive|guest|beauty lane)\b/i],
  ["corporate", /\b(corporate|companies|construction|law firm|company site|brand site)\b/i],
  // "saas" is the weakest signal and is matched on a tighter phrase than you
  // would guess: a bare "platform" describes a category, not an industry.
  ["saas", /\b(web app|dashboard|admin panel|recruitment|job board|job posting|applicant tracking|crm|erp|booking platform)\b/i],
];

// Rows created by the smoke tests are not catalogue inventory. Classifying them
// would put "NotReady Store 1787955240" into a customer-facing category filter.
const TEST_TITLE = /\b(paytest|notready|test ?store|smoke ?test|demo ?store|zzz)\b/i;

function classify(listing) {
  const title = String(listing.title || "");
  const description = String(listing.description || "");
  if (TEST_TITLE.test(title)) return null;

  for (const [slug, re] of RULES) {
    if (re.test(title)) return slug;
  }
  for (const [slug, re] of RULES) {
    if (re.test(description)) return slug;
  }
  return null;
}

// Re-audit mode: report every row whose stored category disagrees with what
// the rules would now say, without writing. The normal backfill deliberately
// skips rows that already have a category, so a rule that has since been fixed
// leaves the wrong value in place forever with no way to spot it. This is the
// escape hatch for that -- it is a report, never a write, because the stored
// value may be a deliberate admin correction rather than a bad guess.
const RECHECK = process.argv.includes("--recheck") && require.main === module;

async function run() {
  const store = await getStore();
  const rows = await store.listings.list({ includeSold: true });

  if (RECHECK) {
    console.log(`RECHECK: ${rows.length} listings audited (no writes)`);
    let disagreements = 0;
    for (const row of rows) {
      const stored = normalizeCategory(row.category) || "";
      if (!stored || stored === DEFAULT_CATEGORY) continue; // nothing asserted yet
      if (TEST_TITLE.test(String(row.title || ""))) continue;
      const guess = classify(row);
      if (!guess || !SLUGS.includes(guess) || guess === stored) continue;
      disagreements++;
      console.log(`  #${row.id} ${row.title} :: stored "${stored}", rules say "${guess}"`);
    }
    console.log(
      disagreements
        ? `${disagreements} disagreement(s). Review each before changing anything by hand.`
        : "No disagreements."
    );
    return;
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${rows.length} listings in scope`);

  const plan = [];
  for (const row of rows) {
    const current = normalizeCategory(row.category) || "";
    if (current && current !== DEFAULT_CATEGORY) continue; // already classified
    const guess = classify(row);
    if (!guess) continue;
    if (!SLUGS.includes(guess)) continue;
    if (current === guess) continue;
    plan.push({ id: row.id, title: row.title, from: current || "(unset)", to: guess });
  }

  if (!plan.length) {
    console.log("Nothing to change.");
    return;
  }
  for (const p of plan) {
    console.log(`  #${p.id} ${p.title} :: ${p.from} -> ${p.to}`);
  }
  console.log(`${plan.length} listing(s) would change.`);

  if (!APPLY) {
    console.log("Re-run with --apply to write these.");
    return;
  }
  for (const p of plan) {
    await store.listings.update(p.id, { category: p.to });
  }
  console.log(`Applied ${plan.length} update(s).`);
}

// `classify` is exported so scripts/classify-check.js can pin the rules to the
// real catalogue. These keyword rules are the kind of thing that rots quietly:
// tightening one pattern to fix a bad row can silently re-file a correct row,
// and nothing would notice until a customer browsed the wrong filter.
if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { classify, RULES, TEST_TITLE };
