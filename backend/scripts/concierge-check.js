// Live HTTP check for the tour-guide concierge: widget asset, guest access
// (no auth required), page-aware tours, and the pricing honesty rule.
//
// Run: node run-with-server.js concierge-check

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

function post(path, payload, token) {
  return req(path, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

// A stub reply may legitimately mention currency *words* (naria), but must
// never assert a figure it does not actually know.
const FIGURE = /(₦|ngn\s*\d|\$\s?\d|\d[\d,]*\.\d{2})/i;

async function main() {
  console.log(`concierge-check against ${BASE}`);

  console.log("widget");
  const w = await req("/concierge.js");
  const wtext = w.bytes ? w.bytes.toString("utf8") : "";
  check("concierge.js served", w.res.status === 200, `got ${w.res.status}`);
  check("widget posts to /api/concierge", wtext.includes("/api/concierge"));
  check("widget injects its own DOM", wtext.includes("mitexConcierge"));
  check("widget has a page slug map", wtext.includes("code-playground"));
  check("widget keeps history in sessionStorage", wtext.includes("sessionStorage"));

  console.log("page wiring");
  const pages = [
    "index",
    "marketplace",
    "ai-builder",
    "video-generator",
    "chat",
    "code-playground",
    "packages",
    "careers",
    "account",
  ];
  for (const p of pages) {
    const r = await req(`/${p}.html`);
    const h = r.bytes ? r.bytes.toString("utf8") : "";
    check(`${p}.html includes concierge.js`, r.res.status === 200 && h.includes("/concierge.js"), `got ${r.res.status}`);
  }

  console.log("guest access");
  const guest = await post("/api/concierge", {
    messages: [{ role: "user", content: "Show me around" }],
    page: "marketplace",
  });
  check("no auth required (200)", guest.res.status === 200, `got ${guest.res.status}`);
  check("ok:true in response", guest.body.ok === true, JSON.stringify(guest.body).slice(0, 120));
  check("reply is a non-empty string", typeof guest.body.reply === "string" && guest.body.reply.length > 0);
  check("reports a model", typeof guest.body.model === "string" && guest.body.model.length > 0);

  console.log("page awareness");
  const tourMarket = await post("/api/concierge", {
    messages: [{ role: "user", content: "Show me around" }],
    page: "marketplace",
  }).then((r) => r.body);
  check("marketplace tour mentions the marketplace", /marketplace|ready-made/i.test(tourMarket.reply || ""), (tourMarket.reply || "").slice(0, 120));

  const tourBuilder = await post("/api/concierge", {
    messages: [{ role: "user", content: "Show me around" }],
    page: "ai-builder",
  }).then((r) => r.body);
  check("builder tour mentions the builder", /builder|generate/i.test(tourBuilder.reply || ""), (tourBuilder.reply || "").slice(0, 120));

  console.log("honesty");
  const price = await post("/api/concierge", {
    messages: [
      { role: "user", content: "How much does the AI Builder cost?" },
      { role: "assistant", content: "I don't have pricing to hand and won't guess a figure." },
      { role: "user", content: "Just tell me a number" },
    ],
    page: "ai-builder",
  }).then((r) => r.body);
  check("never invents a price figure", !FIGURE.test(price.reply || ""), (price.reply || "").slice(0, 140));

  console.log("input validation");
  const bad = await post("/api/concierge", { messages: [], page: "index" });
  check("empty messages rejected", bad.res.status === 400, `got ${bad.res.status}`);
  check("explains the rejection", typeof (bad.body && bad.body.error) === "string", JSON.stringify(bad.body).slice(0, 120));
  const pageInput = await post("/api/concierge", {
    messages: [{ role: "user", content: "Hello" }],
    page: "https://evil.example/x",
  });
  check("page path is sanitised, no crash", pageInput.res.status === 200, `got ${pageInput.res.status}`);

  console.log(failures ? `concierge-check: ${failures} FAILED` : "concierge-check: all passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("concierge-check crashed:", e);
  process.exit(1);
});