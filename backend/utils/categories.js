// Canonical listing categories for the MITEX marketplace.
//
// Why this exists: listings only ever had `asset_type` ("website" or
// "business"), which splits the catalogue by *legal shape* rather than by
// what a buyer is shopping for. A buyer looking for "an online store" or "a
// school portal" had no way to express that, so the marketplace could not be
// browsed or filtered along the axis people actually use.
//
// This is a closed, server-owned vocabulary. Storing free text would let the
// same concept appear as "e-commerce", "E Commerce" and "ecommerce", which
// breaks filtering and fragments SEO landing pages. Clients may send any of
// these slugs; anything else is rejected with a 400 rather than silently
// stored, so the taxonomy cannot drift.

// Ordered most- to least common so admin dropdowns and filter chips read in a
// sensible order. `slug` is the stored value; `label` is the display name.
const CATEGORIES = [
  {
    slug: "ecommerce",
    label: "E-Commerce",
    blurb: "Online stores, catalogues, carts and checkout",
  },
  {
    slug: "corporate",
    label: "Corporate",
    blurb: "Company sites, agency pages and brand presence",
  },
  {
    slug: "portfolio",
    label: "Portfolio",
    blurb: "Personal sites, creative showcases and CV pages",
  },
  {
    slug: "education",
    label: "Education",
    blurb: "Schools, courses, enrolment and student dashboards",
  },
  {
    slug: "real-estate",
    label: "Real Estate",
    blurb: "Property listings, agents and letting portals",
  },
  {
    slug: "healthcare",
    label: "Healthcare",
    blurb: "Clinics, appointment booking and patient portals",
  },
  {
    slug: "restaurant",
    label: "Restaurant & Food",
    blurb: "Menus, reservations, ordering and delivery pages",
  },
  {
    slug: "finance",
    label: "Finance",
    blurb: "Accounting, lending, wallets and fintech dashboards",
  },
  {
    slug: "blog",
    label: "Blog & Publishing",
    blurb: "Magazines, news and content-driven sites",
  },
  {
    slug: "saas",
    label: "SaaS & App",
    blurb: "Product dashboards, web apps and landing pages",
  },
  {
    slug: "services",
    label: "Local Services",
    blurb: "Bookings and lead capture for trades and clinics",
  },
  {
    slug: "other",
    label: "Other",
    blurb: "Anything that does not fit the categories above",
  },
];

// "other" is the honest default: a listing with no category set is not
// evidence of any particular industry.
const DEFAULT_CATEGORY = "other";

const SLUGS = CATEGORIES.map((c) => c.slug);
const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

function isValidCategory(value) {
  return SLUGS.includes(String(value || "").trim().toLowerCase());
}

// Coerce arbitrary input to a valid slug, or null when it is not recognisable.
// Returns null (not a silent fallback) so callers can decide whether to reject
// the request or substitute the default.
function normalizeCategory(value) {
  const s = String(value === undefined || value === null ? "" : value)
    .trim()
    .toLowerCase();
  if (!s) return "";
  if (isValidCategory(s)) return s;
  // Tolerate the label form ("Real Estate") and light punctuation differences so
  // admin UIs and imports do not fail on cosmetic mismatches.
  const squashed = s.replace(/[\s_]+/g, "-");
  if (isValidCategory(squashed)) return squashed;
  return null;
}

function categoryLabel(slug) {
  const c = BY_SLUG.get(normalizeCategory(slug) || "");
  return c ? c.label : (BY_SLUG.get(DEFAULT_CATEGORY) || {}).label || "Other";
}

function categoryOf(row) {
  if (!row) return DEFAULT_CATEGORY;
  const n = normalizeCategory(row.category);
  return n || DEFAULT_CATEGORY;
}

function categoryBlurb(slug) {
  const c = BY_SLUG.get(normalizeCategory(slug) || "");
  return c ? c.blurb : (BY_SLUG.get(DEFAULT_CATEGORY) || {}).blurb || "";
}

// Public shape for GET /api/listings/categories and the admin dropdown.
function publicCategories() {
  return CATEGORIES.map((c) => ({ slug: c.slug, label: c.label, blurb: c.blurb }));
}

module.exports = {
  CATEGORIES,
  SLUGS,
  DEFAULT_CATEGORY,
  isValidCategory,
  normalizeCategory,
  categoryLabel,
  categoryOf,
  categoryBlurb,
  publicCategories,
};