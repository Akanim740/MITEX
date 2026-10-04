/**
 * The forgot-password response must not reveal whether an address has an
 * account.
 *
 * Two ways this leaks, both of which existed or nearly existed:
 *   1. A per-request flag. Reporting "this send failed" from the outcome of
 *      the request only works on the branch that sends, which only runs for
 *      addresses that exist.
 *   2. The cooldown. resetLastSent is only set for real accounts, so a second
 *      request inside the cooldown window takes a different branch -- and if
 *      that branch returns different keys, submitting twice enumerates the
 *      user table.
 *
 * Runs each address twice and compares the full response shape.
 */
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

require("dotenv").config();

const BASE = process.env.CHECK_BASE_URL || "http://localhost:3000";
const STAMP = Date.now();

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
};

const shape = async (email) => {
  const res = await fetch(BASE + "/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => null);
  return {
    status: res.status,
    // devToken/devResetUrl are a deliberate development-only affordance and
    // are not part of the shape an attacker can rely on in production.
    keys: Object.keys(body || {}).filter((k) => k !== "devToken" && k !== "devResetUrl").sort(),
    message: body && body.message,
  };
};

(async () => {
  const health = await fetch(BASE + "/api/health").catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP  no server at ${BASE}`);
    process.exit(0);
  }

  const email = `enum-probe-${STAMP}@example.com`;

  // Register and verify a real account through the public API.
  const reg = await fetch(BASE + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Enum Probe", email, password: "Passw0rd123", dob: "1992-03-04" }),
  }).then((r) => r.json());
  if (reg && reg.devToken) {
    await fetch(`${BASE}/api/auth/verify-email?token=${encodeURIComponent(reg.devToken)}`);
  }
  check("real account exists for the probe", Boolean(reg && reg.user), JSON.stringify(reg).slice(0, 120));

  const missing = `enum-missing-${STAMP}@example.com`;

  const known1 = await shape(email);
  const unknown1 = await shape(missing);
  await new Promise((r) => setTimeout(r, 400));
  const known2 = await shape(email);
  const unknown2 = await shape(missing);

  console.log(`    existing  #1 -> ${JSON.stringify(known1.keys)}`);
  console.log(`    existing  #2 -> ${JSON.stringify(known2.keys)}  (cooldown branch)`);
  console.log(`    unknown   #1 -> ${JSON.stringify(unknown1.keys)}`);
  console.log(`    unknown   #2 -> ${JSON.stringify(unknown2.keys)}`);
  console.log("");

  check(
    "first request identical for existing and unknown",
    JSON.stringify(known1) === JSON.stringify(unknown1),
    `${JSON.stringify(known1)} vs ${JSON.stringify(unknown1)}`
  );
  check(
    "cooldown request identical for existing and unknown",
    JSON.stringify(known2) === JSON.stringify(unknown2),
    `${JSON.stringify(known2)} vs ${JSON.stringify(unknown2)}`
  );
  check(
    "no double-submit difference reveals existence",
    JSON.stringify(known1) === JSON.stringify(known2),
    `${JSON.stringify(known1.keys)} then ${JSON.stringify(known2.keys)}`
  );
  check("message is always the same neutral string", /If that email exists/i.test(known1.message || ""));

  // Leave the local database as we found it.
  try {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "mitex.db"));
    db.exec(`DELETE FROM users WHERE email='${email}'`);
    db.close();
  } catch {
    /* best effort */
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(`CRASH: ${e.message}`);
  process.exit(1);
});