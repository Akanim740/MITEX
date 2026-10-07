// Live HTTP check for the chat assistant API and page.
//
// chat-check.js covers sanitisation and the stub with no server involved;
// this covers the HTTP surface -- auth, status codes, payload limits, the
// 20kb body ceiling, and the rate limiter.
//
// Run: node run-with-server.js chat-api-check

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
    return { res, type, body: await res.json().catch(() => ({})), bytes: null };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return { res, type, body: bytes, bytes };
}

function postJson(path, token, payload) {
  return req(path, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function makeUser() {
  const email = `chat_${crypto.randomBytes(4).toString("hex")}@example.com`;
  const reg = await req("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Chat Check", email, password: "Passw0rd123", dob: "1995-06-15" }),
  }).then((r) => r.body);

  await req(`/api/auth/verify-email?token=${reg.devToken}`);
  const login = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Passw0rd123" }),
  });
  return login.body.accessToken;
}

const one = (text) => [{ role: "user", content: text }];

async function main() {
  console.log(`chat-api-check against ${BASE}`);

  console.log("page");
  const page = await req("/chat.html");
  const html = page.bytes ? page.bytes.toString("utf8") : "";
  check("chat.html served", page.res.status === 200, `got ${page.res.status}`);
  check("loads chat.js", html.includes("chat.js"));
  check("loads auth.js first", html.indexOf("auth.js") < html.indexOf("chat.js"));
  check("thread is a live region", html.includes('aria-live="polite"'));

  const index = await req("/index.html");
  check(
    "linked from index",
    index.res.status === 200 && index.bytes.toString("utf8").includes("/chat.html"),
    `got ${index.res.status}`
  );

  console.log("authentication");
  const anon = await postJson("/api/chat", null, { messages: one("hello") });
  check("requires auth", anon.res.status === 401, `got ${anon.res.status}`);

  const badToken = await postJson("/api/chat", "not-a-real-token", { messages: one("hello") });
  check("rejects a bad token", badToken.res.status === 401, `got ${badToken.res.status}`);

  const token = await makeUser();
  check("login worked", Boolean(token), "no token");

  console.log("input validation");
  const empty = await postJson("/api/chat", token, {});
  check("missing messages 400", empty.res.status === 400, `got ${empty.res.status}`);
  check("has an error message", Boolean(empty.body.error), JSON.stringify(empty.body));

  const notArray = await postJson("/api/chat", token, { messages: "hello" });
  check("non-array messages 400", notArray.res.status === 400, `got ${notArray.res.status}`);

  const assistantLast = await postJson("/api/chat", token, {
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
  });
  check("ending on assistant 400", assistantLast.res.status === 400, `got ${assistantLast.res.status}`);

  const emptyTurns = await postJson("/api/chat", token, { messages: [{ role: "user", content: "   " }] });
  check("blank-only turns 400", emptyTurns.res.status === 400, `got ${emptyTurns.res.status}`);

  console.log("reply");
  const ok = await postJson("/api/chat", token, { messages: one("hello") });
  check("reply succeeds", ok.res.status === 200, JSON.stringify(ok.body).slice(0, 200));
  check("reply is a non-empty string", typeof ok.body.reply === "string" && ok.body.reply.length > 0);
  check("reports a model", Boolean(ok.body.model), String(ok.body.model));
  check("reports usage", Boolean(ok.body.usage), JSON.stringify(ok.body.usage));
  check("response is application/json", ok.type.includes("application/json"), ok.type);

  console.log("multi-turn");
  const turn1 = await postJson("/api/chat", token, { messages: one("hello") });
  const turn2 = await postJson("/api/chat", token, {
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: turn1.body.reply || "hi" },
      { role: "user", content: "how much does it cost?" },
    ],
  });
  check("history accepted", turn2.res.status === 200, JSON.stringify(turn2.body).slice(0, 200));
  check(
    "pricing asked with history is still not invented",
    typeof turn2.body.reply === "string" && !/[₦$€£]\s*\d/.test(turn2.body.reply),
    String(turn2.body.reply)
  );

  console.log("injection and limits");
  const xss = await postJson("/api/chat", token, {
    messages: one('<img src=x onerror="alert(1)"> what do you do?'),
  });
  check("markup in input accepted", xss.res.status === 200, `got ${xss.res.status}`);
  check(
    "reply is returned as a JSON string, not parsed HTML",
    xss.type.includes("application/json") && typeof xss.body.reply === "string"
  );
  check("reply has no raw img tag", !/<img\b/i.test(xss.body.reply || ""), String(xss.body.reply).slice(0, 80));

  // Bigger than express.json's 20kb ceiling -- must be refused before the
  // service ever sees it.
  const huge = await postJson("/api/chat", token, { messages: one("a".repeat(30000)) });
  check("30kb body rejected (413)", huge.res.status === 413, `got ${huge.res.status}`);

  const longOk = await postJson("/api/chat", token, { messages: one("b".repeat(3500)) });
  check("3.5kb message still handled", longOk.res.status === 200, `got ${longOk.res.status}`);

  console.log("rate limiting (runs last)");
  let sawLimit = false;
  let lastStatus = 0;
  for (let i = 0; i < 40 && !sawLimit; i++) {
    const r = await postJson("/api/chat", token, { messages: one(`ping ${i}`) });
    lastStatus = r.res.status;
    if (r.res.status === 429) sawLimit = true;
  }
  check("429 after sustained traffic", sawLimit, `last status ${lastStatus}`);

  if (failures) {
    console.error(`\nchat-api-check: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nchat-api-check: all passed");
}

main().catch((e) => {
  console.error("chat-api-check crashed:", e.message);
  process.exit(1);
});
