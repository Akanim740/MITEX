// MITEX listing intelligence: Website Score, AI Valuator, Trust Score.
// Deterministic, schema-light: computed from existing listing fields so the
// whole product works even before the optional columns migrate (prod).

function websiteScore(row) {
  if (!row) return { score: 0, label: "Basic" };
  const level = Number(row.level) || 1;
  let s = 30;
  s += Math.max(0, Math.min(36, level * 6));
  if (row.delivery_url) s += 14;
  const tokens = String(row.tech_stack || "").split(/[\n,;•|/]+/).map((t) => t.trim()).filter(Boolean);
  s += Math.min(15, tokens.length * 3);
  const len = String(row.description || "").length;
  if (len >= 120) s += 8;
  if (len >= 260) s += 4;
  if (String(row.status) === "sold") s += 6;
  if (row.employee_id) s += 7;
  s = Math.max(0, Math.min(100, Math.round(s)));
  const label = s >= 90 ? "Excellent" : s >= 75 ? "Great" : s >= 55 ? "Good" : s >= 35 ? "Fair" : "Basic";
  return { score: s, label, max: 100 };
}

function sellerTrust(stats) {
  if (!stats) return { score: 40, label: "Getting established", max: 100 };
  let s = 40;
  const delivered = Number(stats.delivered) || 0;
  const paid = Number(stats.paid) || 0;
  s += Math.min(40, delivered * 10);
  s += Math.min(20, paid * 4);
  s = Math.max(0, Math.min(100, Math.round(s)));
  const label = s >= 80 ? "Very reliable" : s >= 65 ? "Reliable" : s >= 50 ? "Building trust" : "Getting established";
  return { score: s, label, max: 100 };
}

// Fair-selling-price estimator (names it "AI Valuator" in the UX; weights are
// deterministic so every request is reproducible and testable).
const LEVEL_BASE = [0, 60000, 110000, 180000, 320000, 520000, 850000, 1400000];

function valuate({ level, tech_stack, description, title } = {}) {
  const rawLevel = Math.max(0, Math.min(7, Number(level) || 0));
  const base = LEVEL_BASE[rawLevel] || 520000;
  const tokens = String(tech_stack || "").split(/[\n,;•|/]+/).map((t) => t.trim()).filter(Boolean);
  const tc = Math.min(5, tokens.length);
  const techBoost = tc * 6000;
  const descBonus = String(description || "").trim().length >= 150 ? 8000 : 0;
  const titleBonus = String(title || "").trim().length >= 20 ? 4000 : 0;
  let estimate = base + techBoost + descBonus + titleBonus;
  estimate = Math.max(25000, Math.round(estimate / 5000) * 5000);
  const range = Math.max(20000, Math.round(estimate * 0.18));
  const confidence = Math.min(92, 56 + (rawLevel ? 8 : 0) + (tokens.length ? 8 : 0) + (String(description || "").trim() ? 6 : 0));
  const drivers = [{ label: `Base value (level ${rawLevel || "unrated"})`, amount: base }];
  if (tc) drivers.push({ label: `${tc} tech feature${tc === 1 ? "" : "s"}`, amount: techBoost });
  if (descBonus) drivers.push({ label: "Detailed description", amount: descBonus });
  if (titleBonus) drivers.push({ label: "Complete listing title", amount: titleBonus });
  return {
    estimate,
    min: Math.max(0, estimate - range),
    max: estimate + range,
    confidence,
    currency: "NGN",
    drivers,
  };
}

function assetTypeOf(row) {
  return String((row && row.asset_type) || "website") === "business" ? "business" : "website";
}

function protectedOf(row) {
  return !(row && row.protected === false || row && Number(row.protected) === 0);
}

module.exports = { websiteScore, sellerTrust, valuate, assetTypeOf, protectedOf };