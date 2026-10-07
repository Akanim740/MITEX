// Live HTTP check for the video generator API and page.
//
// video-check.js covers the service layer with no server involved; this covers
// the HTTP surface -- auth, ownership, content types, input limits.
//
// Run: node run-with-server.js video-api-check   (spawns the server for you)
//  or: node scripts/video-api-check.js           (if one is already up)

const crypto = require("crypto");

const BASE = process.env.SEO_TEST_BASE || process.env.BASE_URL || "http://localhost:3000";

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    // Parsed objects are kept separate from `bytes`: Buffer.from() on a plain
    // object throws rather than returning something empty.
    return { res, type, body: await res.json().catch(() => ({})), bytes: null };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return { res, type, body: bytes, bytes };
}

async function makeUser() {
  const email = `vid_${crypto.randomBytes(4).toString("hex")}@example.com`;
  const reg = await req("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Vid Check", email, password: "Passw0rd123", dob: "1995-06-15" }),
  }).then((r) => r.body);

  await req(`/api/auth/verify-email?token=${reg.devToken}`);
  const login = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Passw0rd123" }),
  });

  const cookie = (login.res.headers.getSetCookie ? login.res.headers.getSetCookie() : [])
    .map((c) => c.split(";")[0])
    .join("; ");

  return {
    auth: { authorization: `Bearer ${login.body.accessToken}` },
    cookie,
    id: login.body.user && login.body.user.id,
  };
}

async function generate(user, extra = {}) {
  const r = await req("/api/video/generate", {
    method: "POST",
    headers: { ...user.auth, "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "Launch of our portfolio site. Built with MITEX.",
      aspect: "landscape",
      durationSec: 6,
      ...extra,
    }),
  });
  return r;
}

async function main() {
  console.log(`video-api-check against ${BASE}`);

  console.log("page");
  const page = await req("/video-generator.html");
  const html = page.bytes ? page.bytes.toString("utf8") : "";
  check("video-generator.html served", page.res.status === 200, `got ${page.res.status}`);
  check("loads video-generator.js", html.includes("video-generator.js"));
  check("loads auth.js first", html.indexOf("auth.js") < html.indexOf("video-generator.js"));

  const indexHtml = await req("/index.html");
  check(
    "video generator linked from index",
    indexHtml.res.status === 200 && indexHtml.bytes.toString("utf8").includes("video-generator.html"),
    `got ${indexHtml.res.status}`
  );

  console.log("authentication");
  const anon = await req("/api/video/generate", { method: "POST" });
  check("generate requires auth", anon.res.status === 401, `got ${anon.res.status}`);

  const user = await makeUser();
  const user2 = await makeUser();
  check("login worked", Boolean(user.auth.authorization), "no token");
  check("refresh cookie issued", user.cookie.includes("mitex_refresh"), user.cookie.slice(0, 40));

  console.log("input validation");
  const noPrompt = await req("/api/video/generate", {
    method: "POST",
    headers: { ...user.auth, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  check("empty prompt rejected", noPrompt.res.status === 400, `got ${noPrompt.res.status}`);

  const tooLong = await generate(user, { prompt: "x".repeat(5000) });
  check("oversized prompt rejected", tooLong.res.status === 400, `got ${tooLong.res.status}`);

  console.log("render");
  const gen = await generate(user);
  check("generate succeeded", gen.res.status === 200, JSON.stringify(gen.body).slice(0, 200));
  check("returns id", /^[a-f0-9]{32}$/.test(gen.body.id || ""), String(gen.body.id));
  check("reports stub model", String(gen.body.model || "").length > 0, String(gen.body.model));
  check("has scenes", (gen.body.script && gen.body.script.scenes || []).length > 0);

  if (!gen.body.id) {
    if (failures) process.exit(1);
    return;
  }

  const id = gen.body.id;

  console.log("preview and download");
  const authed = await req(`/api/video/${id}`, { headers: user.auth });
  check("preview with Bearer", authed.res.status === 200, `got ${authed.res.status}`);
  check("preview is image/gif", authed.type === "image/gif", authed.type);
  check("preview has GIF89a magic", authed.bytes.subarray(0, 6).toString("ascii") === "GIF89a");
  check("preview has content-length", Number(authed.res.headers.get("content-length")) > 1000);
  check("preview is not publicly cacheable", (authed.res.headers.get("cache-control") || "").includes("private"));

  const cookieOnly = await req(`/api/video/${id}`, { headers: { cookie: user.cookie } });
  check("preview works with refresh cookie only", cookieOnly.res.status === 200, `got ${cookieOnly.res.status}`);

  const dl = await req(`/api/video/${id}?download=1`, { headers: user.auth });
  check("download sets attachment", (dl.res.headers.get("content-disposition") || "").startsWith("attachment"));

  const meta = await req(`/api/video/${id}/meta`, { headers: user.auth });
  check("meta returns script", meta.res.status === 200 && meta.body.ok === true, `got ${meta.res.status}`);

  console.log("access control");
  const badId = await req(`/api/video/../../etc/passwd`, { headers: user.auth });
  check("path traversal rejected", badId.res.status >= 400, `got ${badId.res.status}`);

  const bogus = await req(`/api/video/${"a".repeat(32)}`, { headers: user.auth });
  check("unknown id 404", bogus.res.status === 404, `got ${bogus.res.status}`);

  const malformed = await req(`/api/video/not!valid`, { headers: user.auth });
  check("malformed id 400", malformed.res.status === 400, `got ${malformed.res.status}`);

  const stranger = await req(`/api/video/${id}`, { headers: user2.auth });
  check("other user's video 403", stranger.res.status === 403, `got ${stranger.res.status}`);

  const anonPreview = await req(`/api/video/${id}`);
  check("anonymous preview blocked", anonPreview.res.status === 401, `got ${anonPreview.res.status}`);

  if (failures) {
    console.error(`\nvideo-api-check: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nvideo-api-check: all passed");
}

main().catch((e) => {
  console.error("video-api-check crashed:", e.message);
  process.exit(1);
});
