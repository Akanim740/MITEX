// Unit checks for the chat service: input sanitisation, the multi-turn helper
// in utils/ai, and the offline stub.
//
// The stub is the state this actually ships in (API credits are at zero), so
// it gets the most attention here -- specifically that it never states a price.
//
// Run: node scripts/chat-check.js

const assert = require("assert");

process.env.AI_STUB = "true";

const { sanitizeMessages, chat, LIMITS } = require("../services/ai-chat");
const { chatStub, REPLIES, FOLLOWUPS } = require("../services/ai-chat-stub");
const { normalizeMessages } = require("../utils/ai");

let pass = 0;
let fail = 0;

function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label} -- ${e.message}`);
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label} -- ${e.message}`);
  }
}

(async function main() {
  console.log("normalizeMessages (utils/ai)");

  check("single turn built from prompt", () => {
    const out = normalizeMessages(null, "  hello  ");
    assert.deepStrictEqual(out, [{ role: "user", content: "hello" }]);
  });

  check("empty prompt yields no turns", () => {
    assert.deepStrictEqual(normalizeMessages(undefined, "   "), []);
  });

  check("conversation takes precedence over prompt", () => {
    const out = normalizeMessages(
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      "ignored"
    );
    assert.strictEqual(out.length, 2);
  });

  check("malformed turns are dropped", () => {
    const out = normalizeMessages(
      [
        { role: "system", content: "nope" },
        { role: "user", content: "" },
        { role: "assistant" },
        null,
        { role: "user", content: "real" },
      ],
      null
    );
    assert.deepStrictEqual(out, [{ role: "user", content: "real" }]);
  });

  check("leading assistant turns are stripped", () => {
    const out = normalizeMessages(
      [
        { role: "assistant", content: "orphan" },
        { role: "user", content: "hi" },
      ],
      null
    );
    assert.deepStrictEqual(out, [{ role: "user", content: "hi" }]);
  });

  console.log("sanitizeMessages");

  check("rejects a missing array", () => {
    for (const bad of [undefined, null, "hi", 42, {}]) {
      const r = sanitizeMessages(bad);
      assert.strictEqual(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    }
  });

  check("rejects an empty array", () => {
    assert.strictEqual(sanitizeMessages([]).ok, false);
  });

  check("rejects an oversized payload before parsing", () => {
    const many = Array.from({ length: LIMITS.maxPayloadMessages + 1 }, () => ({
      role: "user",
      content: "x",
    }));
    const r = sanitizeMessages(many);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Too many messages/);
  });

  check("drops malformed turns instead of failing", () => {
    const r = sanitizeMessages([
      { role: "user", content: "keep me" },
      { role: "system", content: "drop" },
      { role: "user", content: "" },
      "not an object",
      null,
    ]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.messages.length, 1);
    assert.strictEqual(r.messages[0].content, "keep me");
  });

  check("truncates an over-long message and warns", () => {
    const r = sanitizeMessages([{ role: "user", content: "y".repeat(99999) }]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.messages[0].content.length, LIMITS.maxCharsPerMessage);
    assert.ok(r.warnings.some((w) => /truncated/.test(w)), "no truncation warning");
  });

  check("merges consecutive same-role turns", () => {
    const r = sanitizeMessages([
      { role: "user", content: "one" },
      { role: "user", content: "two" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "next" }, // must end on a user turn
    ]);
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.messages.length, 3);
    assert.strictEqual(r.messages[0].role, "user");
    assert.match(r.messages[0].content, /one[\s\S]*two/);
  });

  check("rejects a conversation ending on an assistant turn", () => {
    const r = sanitizeMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /end with a user message/);
  });

  check("rejects one that only contains assistant turns", () => {
    const r = sanitizeMessages([{ role: "assistant", content: "hello" }]);
    assert.strictEqual(r.ok, false);
  });

  check("keeps the newest turns when over the turn limit", () => {
    const many = Array.from({ length: LIMITS.maxMessages + 6 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));
    many.push({ role: "user", content: "newest" });
    const r = sanitizeMessages(many);
    assert.strictEqual(r.ok, true);
    assert.ok(r.messages.length <= LIMITS.maxMessages, `kept ${r.messages.length}`);
    assert.strictEqual(r.messages[r.messages.length - 1].content, "newest");
    assert.strictEqual(r.messages[0].role, "user");
    assert.ok(r.warnings.some((w) => /turn limit/.test(w)));
  });

  check("stays inside the context budget", () => {
    // Alternating roles: consecutive same-role turns get merged, which would
    // short-circuit the budget check instead of exercising it.
    const bulk = "z".repeat(LIMITS.maxCharsPerMessage);
    const many = Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: bulk,
    }));
    many.push({ role: "user", content: "final" });
    const r = sanitizeMessages(many);
    assert.strictEqual(r.ok, true);
    const total = r.messages.reduce((n, m) => n + m.content.length, 0);
    assert.ok(total <= LIMITS.maxTotalChars, `total ${total}`);
    assert.strictEqual(r.messages[0].role, "user");
    assert.strictEqual(r.messages[r.messages.length - 1].content, "final");
  });

  check("consecutive merges do not blow the per-message cap", () => {
    const big = "q".repeat(LIMITS.maxCharsPerMessage - 10);
    const r = sanitizeMessages([
      { role: "user", content: big },
      { role: "user", content: big },
    ]);
    assert.strictEqual(r.ok, true);
    assert.ok(r.messages[0].content.length <= LIMITS.maxCharsPerMessage);
  });

  console.log("chat() in stub mode");

  await checkAsync("returns a reply and the stub model", async () => {
    const r = await chat({ messages: [{ role: "user", content: "hello" }] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.model, "stub/mitex-chat");
    assert.ok(typeof r.reply === "string" && r.reply.length > 0);
    assert.ok(r.usage);
  });

  await checkAsync("throws 400 on a bad conversation", async () => {
    await assert.rejects(
      () => chat({ messages: [{ role: "assistant", content: "x" }] }),
      (e) => e.status === 400
    );
  });

  console.log("stub replies");

  const cases = [
    ["greeting", "hi", REPLIES.greeting],
    ["pricing", "how much does a website cost?", REPLIES.pricing],
    ["builder", "how do I build a site?", REPLIES.builder],
    ["video", "can you make an animation?", REPLIES.video],
    ["marketplace", "show me the templates", REPLIES.marketplace],
    ["hosting", "how do I deploy this?", REPLIES.host],
    ["careers", "are you hiring?", REPLIES.careers],
    ["thanks", "thanks", REPLIES.thanks],
  ];

  for (const [label, prompt, expected] of cases) {
    await checkAsync(`answers ${label}`, async () => {
      const r = await chatStub({ messages: [{ role: "user", content: prompt }] });
      assert.strictEqual(r.reply, expected);
    });
  }

  await checkAsync("answers a real web question", async () => {
    const r = await chatStub({ messages: [{ role: "user", content: "how do I make my site responsive?" }] });
    assert.match(r.reply, /mobile-first/i);
  });

  await checkAsync("falls back honestly on an unanswerable prompt", async () => {
    const r = await chatStub({
      messages: [{ role: "user", content: "what is the airspeed velocity of an unladen swallow?" }],
    });
    assert.strictEqual(r.reply, REPLIES.fallback);
  });

  await checkAsync("looks at the last user turn, not the raw array tail", async () => {
    const r = await chatStub({
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: REPLIES.greeting },
      ],
    });
    assert.strictEqual(r.reply, REPLIES.greeting);
  });

  // The stub grew a set of concrete intents on top of the original eight. Each
  // has to route correctly, including the plural/verb forms people actually
  // type. New replies must stay inside the honesty rules checked below.
  const more = [
    ["payment", "how do I pay after the build is approved?", REPLIES.payment],
    ["download", "how do I download my project?", REPLIES.download],
    ["account", "how do I log in to my account?", REPLIES.account],
    ["refund (plural)", "do you do refunds?", REPLIES.refund],
    ["review (verb)", "when will my build be reviewed?", REPLIES.review],
    ["edit (verb)", "can you update the contact page?", REPLIES.edit],
    ["about", "what is mitex?", REPLIES.about],
    ["help", "what can you do?", REPLIES.help],
    ["tech", "what are generated sites made of?", REPLIES.tech],
  ];

  for (const [label, prompt, expected] of more) {
    await checkAsync(`answers ${label}`, async () => {
      const r = await chatStub({ messages: [{ role: "user", content: prompt }] });
      assert.strictEqual(r.reply, expected);
    });
  }

  await checkAsync("answers a short follow-up from the conversation topic", async () => {
    const r = await chatStub({
      messages: [
        { role: "user", content: "how do I build a site?" },
        { role: "assistant", content: REPLIES.builder },
        { role: "user", content: "how do I get it?" },
      ],
    });
    assert.strictEqual(r.reply, FOLLOWUPS.builder);
  });

  await checkAsync("keeps a generic fallback when there is no topic to follow up on", async () => {
    const r = await chatStub({
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: REPLIES.greeting }, { role: "user", content: "and then?" }],
    });
    assert.strictEqual(r.reply, REPLIES.fallback);
  });

  console.log("stub never invents a price");

  const pricingPrompts = [
    "how much does it cost?",
    "what is the price of a website?",
    "how much for NGN?",
    "can I afford this on $100?",
    "give me a quote",
    "what are your fees?",
    "how much is ₦5000?",
  ];

  for (const p of pricingPrompts) {
    await checkAsync(`no invented figure for "${p}"`, async () => {
      const r = await chatStub({ messages: [{ role: "user", content: p }] });
      assert.strictEqual(r.reply, REPLIES.pricing);
      assert.ok(!/[₦$€£]\s*\d/.test(r.reply), "reply contains a currency figure");
      assert.ok(!/\b\d+(\.\d+)?\s*(ngn|naira|usd|dollars?|hours?|days?|weeks?)\b/i.test(r.reply), "reply contains a figure");
    });
  }

  await checkAsync("no turnaround claims anywhere in the stub", async () => {
    for (const reply of Object.values(REPLIES)) {
      assert.ok(!/\b\d+\s*(hour|day|week|month)s?\b/i.test(reply), `time claim: ${reply}`);
      assert.ok(!/[₦$€£]\s*\d/.test(reply), `price claim: ${reply}`);
      assert.ok(!/\b\d{2,}%\b/.test(reply), `statistic: ${reply}`);
    }
  });

  await checkAsync("every link the stub suggests is a real page", async () => {
    const fs = require("fs");
    const path = require("path");
    const root = path.join(__dirname, "..", "..");
    const { PAGES } = require("../services/ai-chat-stub");
    for (const href of Object.values(PAGES)) {
      const file = path.join(root, href.replace(/^\//, ""));
      assert.ok(fs.existsSync(file), `missing page ${href}`);
    }
  });

  console.log(`\nchat-check: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
