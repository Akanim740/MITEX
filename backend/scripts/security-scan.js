/**
 * MITEX Self-Defence Scanner
 * --------------------------
 * Simulates common attacks against YOUR OWN MITEX deployment to verify its
 * defences hold. It never targets any other site or person - running it
 * against a domain you do not own is illegal.
 *
 * Usage:
 *   node security-scan.js https://mitex.onrender.com
 */

const BASE = (process.argv[2] || "http://127.0.0.1:4321").replace(/\/+$/, "");
const fs = require("fs");
const OUT = __dirname + "/security-report.txt";

let pass = 0;
let warn = 0;
let fail = 0;

function log(line) {
  console.log(line);
  fs.appendFileSync(OUT, line + "\n");
}
function check(name, level, cond, detail) {
  const mark = cond ? "PASS" : level.toUpperCase();
  if (cond) pass++;
  else if (level === "warn") warn++;
  else fail++;
  log(`${mark.padEnd(5)} ${name}${detail && !cond ? " | " + detail : ""}`);
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: "manual", ...opts });
  let body = "";
  try {
    body = await res.text();
  } catch {}
  return { status: res.status, headers: res.headers, body };
}

(async () => {
  fs.writeFileSync(OUT, `MITEX self-defence scan for ${BASE}\n${new Date().toISOString()}\n\n`);

  // ---- 1. Source code exposure ----
  for (const p of ["/backend/server.js", "/backend/package.json", "/supabase-setup.sql", "/.git/config", "/package.json"]) {
    const r = await req(p);
    check(`source blocked: ${p}`, "fail", r.status === 404 || r.status === 403, `returned ${r.status}`);
  }

  // ---- 2. Security headers on homepage ----
  const home = await req("/");
  const h = home.headers;
  check("HSTS header present", "warn", Boolean(h.get("strict-transport-security")));
  check("X-Content-Type-Options: nosniff", "warn", h.get("x-content-type-options") === "nosniff");
  check("X-Frame-Options / frame guard", "warn", Boolean(h.get("x-frame-options") || h.get("content-security-policy")));

  // ---- 3. Admin endpoints refuse strangers ----
  const adminPaths = [
    ["/api/applications", "GET"],
    ["/api/salaries", "GET"],
    ["/api/auth/staff", "GET"],
    ["/api/payments/orders", "GET"],
    ["/api/enquiries", "GET"],
    ["/api/newsletter", "GET"],
  ];
  for (const [p, m] of adminPaths) {
    const r = await req(p, { method: m });
    check(`admin API locked: ${m} ${p}`, "fail", r.status === 401 || r.status === 403, `returned ${r.status}`);
  }

  // ---- 4. Injection probes on public inputs (harmless strings) ----
  const probes = ["' OR 1=1 --", "<script>alert(1)</script>", "../../etc/passwd"];
  for (const probe of probes) {
    const r = await req("/api/enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: probe.slice(0, 30), email: `probe${Date.now()}@example.com`, message: probe + " scan test message long enough here" }),
    });
    // Accept either validation rejection or clean accept; the danger is a 500 crash revealing stack info
    check(`injection probe handled (${probe.slice(0, 18)}...)`, "fail", r.status !== 500, `returned ${r.status}`);
    if (r.body.includes("Error:") && r.body.includes("at ")) {
      check("no stack trace leak", "fail", false, r.body.slice(0, 120));
      break;
    }
  }

  // ---- 5. Rate limiting on auth ----
  let limited = false;
  for (let i = 0; i < 35; i++) {
    const r = await req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bruteforce-probe@example.com", password: "wrongpass123" }),
    });
    if (r.status === 429) {
      limited = true;
      break;
    }
  }
  check("login brute force throttled (429)", "warn", limited, "35 attempts accepted");

  // ---- 6. Application form abuse limits ----
  let appLimited = false;
  for (let i = 0; i < 20; i++) {
    const r = await req("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Spam Probe ${i}`,
        email: `spam-probe-${Date.now()}-${i}@example.com`,
        message: "Automated defence verification submission number " + i,
      }),
    });
    if (r.status === 429) {
      appLimited = true;
      break;
    }
  }
  check("application spam throttled (429)", "warn", appLimited, "20 submissions accepted");

  // ---- 7. Cookie flags after login attempt ----
  const cookieRes = await req("/api/auth/refresh", { method: "POST" });
  const setCookie = cookieRes.headers.get("set-cookie") || "";
  check("refresh cookie httpOnly", "fail", !setCookie || setCookie.toLowerCase().includes("httponly"), setCookie.slice(0, 80));

  // ---- 8. Unknown API routes do not leak stacks ----
  const nf = await req("/api/nonexistent-endpoint-xyz");
  check("unknown API returns clean 404", "fail", nf.status === 404 && !nf.body.includes("at "), `returned ${nf.status}`);

  log(`\nRESULT: ${pass} passed, ${warn} warnings, ${fail} failures`);
  log(fail === 0 ? "Your defences held against every attack simulation." : "Review the FAIL lines above.");
})().catch((e) => {
  log(`CRASH: ${e.message}`);
  process.exit(1);
});
