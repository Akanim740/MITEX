// Spawns the backend, runs a check against it, then tears it down. Used
// because the live-HTTP suites need a running server and this shell cannot
// reliably start background processes with Start-Process.
//
// Run: node run-with-server.js seo-check        (runs scripts/seo-check.js)
//      node run-with-server.js smoke-test.ps1   (runs scripts/smoke-test.ps1)
//      node run-with-server.js security-scan -- -- http://localhost:3010
// Extra arguments after the script name are forwarded; the server base URL is
// passed both as env vars and as a trailing argument, since some checks read
// argv[2] instead.

const { spawn } = require("child_process");
const path = require("path");

const which = process.argv[2] || "seo-check";
const PORT = process.env.TEST_PORT || "3010";
const BASE = `http://localhost:${PORT}`;
const backend = path.join(__dirname, "backend");

const isPs = which.toLowerCase().endsWith(".ps1");
const extra = process.argv.slice(3);
const cmd = isPs ? "powershell.exe" : "node";
const args = isPs
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(backend, "scripts", which), ...extra]
  : [`scripts/${which}.js`, ...extra, ...(extra.includes(BASE) ? [] : [BASE])];

const server = spawn("node", ["server.js"], {
  cwd: backend,
  env: { ...process.env, PORT, AI_STUB: "true" },
  stdio: ["ignore", "pipe", "pipe"],
});

let ready = false;
server.stdout.on("data", (d) => {
  if (String(d).includes("running at")) ready = true;
});
server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

(async () => {
  for (let i = 0; i < 80 && !ready; i++) await new Promise((r) => setTimeout(r, 250));
  if (!ready) {
    console.error("server did not start");
    server.kill();
    process.exit(1);
  }

  const check = spawn(cmd, args, {
    cwd: backend,
    env: {
      ...process.env,
      BASE_URL: BASE,
      SEO_TEST_BASE: BASE,
      TEST_BASE_URL: BASE,
      PORT,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const code = await new Promise((resolve) => check.on("exit", resolve));
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
  process.exit(code === null ? 1 : code);
})();
