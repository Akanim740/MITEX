#!/usr/bin/env node
// Scans the working tree for committed secrets. Run before every commit:
//   node backend/scripts/scan-secrets.js
// Exits 1 if anything that looks like a live credential is found.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".git", "deliveries", "data", "test-results", ".well-known"]);
const SKIP_FILE = /(\.db|\.sqlite3?|\.log|package-lock\.json|\.png|\.jpe?g|\.gif|\.webp|\.ico|\.woff2?|\.pdf|\.zip)$/i;

// Filenames that legitimately hold placeholders, not live secrets.
const ALLOW_FILE = /(^|[\\/])\.env\.example$/i;

// Smoke-test harnesses hardcode throwaway passwords (e.g. "ChangeMe123!") for
// accounts they create on a local test server. Allowlist only these known
// files - backend/routes and the frontend stay fully scanned.
const TEST_FIXTURE = /backend[\\/]scripts[\\/](smoke-test|notready-smoke-test|payments-smoke-test|payments-resume-check|phase7-notif-check|pkg-crud-check|security-scan|analyze-smoke-test)\.(ps1|js)$/i;

const RULES = [
  { name: "private-key", re: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z\-_]{30,}\b/g },
  { name: "stripe-secret", re: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { name: "paystack-secret", re: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { name: "sendgrid-key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  { name: "npm-token", re: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { name: "supabase-service-key", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Assignments that hardcode a secret instead of reading process.env.
  // Matches PREFIXED names too (DB_PASSWORD, SUPER_SECRET, ...), not just
  // bare ones - "\b" would never fire between "_" and the keyword.
  { name: "hardcoded-secret-assignment", re: /[A-Za-z0-9_]*(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY|SERVICE_KEY)\s*[:=]\s*["'][^"'\n]{12,}["']/gi },
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".git") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const findings = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (SKIP_FILE.test(file) || ALLOW_FILE.test(rel) || TEST_FIXTURE.test(rel)) continue;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split("\n").length;
      findings.push({ rel, line, name: rule.name, snippet: m[0].slice(0, 60) });
    }
  }
}

if (findings.length) {
  console.error(`FAIL  ${findings.length} possible secret(s) committed:\n`);
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  [${f.name}]  ${f.snippet}`);
  }
  console.error("\nMove real secrets to .env (git-ignored) and rotate anything that was ever pushed.");
  process.exit(1);
}
console.log("PASS  no committed secrets found");
