// Conversational assistant behind POST /api/chat.
//
// Two properties matter here and both are enforced in this file rather than
// left to the model:
//
//   1. The conversation is bounded. A chat client controls the message array,
//      so it is the cheapest way to make one user spend unbounded money.
//      sanitizeMessages() caps turn count, per-message length and total
//      context before anything reaches the provider.
//   2. The model does not get to invent facts about MITEX. The system prompt
//      forbids prices, timings, testimonials and statistics outright, because
//      a chat window is exactly where a plausible-sounding number does damage.
//
// Conversation history stays on the client (localStorage). Persisting it would
// mean a schema change across every database adapter for no benefit the user
// can see, and a chat log is not worth that.

const ai = require("../utils/ai");
const { chatStub } = require("./ai-chat-stub");

// Sized to fit inside the app-wide express.json limit of 20kb (server.js:150),
// which is a deliberate hardening choice we are not going to loosen for chat.
// The raw request dies there first; these limits are the semantic layer on top
// -- they decide what is *worth* sending to the model, not just what parses.
const LIMITS = {
  maxMessages: 12, // turns kept in a conversation
  maxPayloadMessages: 40, // belt-and-braces before parsing
  maxCharsPerMessage: 2000,
  maxTotalChars: 16000, // 16k text + per-turn overhead stays under 20kb
  maxReplyChars: 6000,
};

const SYSTEM_PROMPT = [
  "You are the MITEX assistant, the conversational front for MITEX, a marketplace",
  "for ready-made websites with an AI Builder (turns a brief into a complete",
  "static site) and an AI Video Generator.",
  "",
  "Pages you can point people at - write them as the path so they can open them:",
  "- Marketplace (ready-made sites): /marketplace.html",
  "- Packages (what is on offer): /packages.html",
  "- AI Builder: /ai-builder.html",
  "- Video Generator: /video-generator.html",
  "- Account: /account.html",
  "- Careers: /careers.html",
  "",
  "How project work actually flows (say this, never improve on it):",
  "- The AI Builder turns a written brief into plain HTML, CSS and JavaScript.",
  "- A build is reviewed, then ordered and confirmed, and only after that is the",
  "  project released and available to download as a ZIP.",
  "- Prices, fees, turnaround times, statistics, customer counts and testimonials",
  "  are NOT facts you know. Never state them, and do not estimate them.",
  "",
  "How to behave:",
  "- Answer the question actually asked. When someone asks you to build or price",
  "  something, ask the two or three clarifying questions that would change the",
  "  outcome, then give one concrete next step.",
  "- Be direct and concise. Chat, not an essay: a few sentences unless the",
  "  question genuinely needs more. Plain text only, no HTML. Use '-' for lists",
  "  and ``` fences for short code snippets.",
  "- Never invent facts. Do not state prices, discounts, delivery times,",
  "  availability, statistics, testimonials or awards unless the user has put",
  "  them in front of you. If you do not know a figure, say plainly that you do",
  "  not have it and point them to the right page or to MITEX directly.",
  "- Do not claim to have done anything or to act on their behalf. You are text",
  "  in a chat window: you cannot browse, send email, charge a card, or run",
  "  commands.",
  "- General web questions (HTML, CSS, JavaScript, hosting, domains,",
  "  responsiveness, accessibility, SEO) you can answer fully and accurately.",
  "- If a request is harmful, illegal or asks you to break something, decline",
  "  briefly and offer the legitimate alternative. Do not lecture.",
  "- If you are unsure, say so. Never guess a fact about MITEX.",
].join("\n");

/**
 * Validate and bound an incoming conversation.
 *
 * Returns { ok, messages, warnings, error }. Never throws -- the route turns
 * `ok: false` into a 400 with the reason.
 */
function sanitizeMessages(raw) {
  const warnings = [];

  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, messages: [], warnings, error: "messages must be a non-empty array" };
  }
  if (raw.length > LIMITS.maxPayloadMessages) {
    return {
      ok: false,
      messages: [],
      warnings,
      error: `Too many messages (limit ${LIMITS.maxPayloadMessages})`,
    };
  }

  const kept = [];
  for (const m of raw) {
    const role = m && (m.role === "user" || m.role === "assistant") ? m.role : null;
    const content = m && typeof m.content === "string" ? m.content.trim() : "";
    if (!role || !content) continue; // silently drop malformed turns

    let text = content;
    if (text.length > LIMITS.maxCharsPerMessage) {
      text = text.slice(0, LIMITS.maxCharsPerMessage);
      warnings.push("A message was truncated to the length limit");
    }

    // The API wants alternating roles. A client that sends twice in a row
    // (double-click, retry) would otherwise be rejected, so merge instead.
    const prev = kept[kept.length - 1];
    if (prev && prev.role === role) {
      prev.content = (prev.content + "\n\n" + text).slice(0, LIMITS.maxCharsPerMessage);
    } else {
      kept.push({ role, content: text });
    }
  }

  if (!kept.length) {
    return { ok: false, messages: [], warnings, error: "No usable messages were provided" };
  }

  // Must open and close on a user turn: we are asking for the assistant's
  // next reply, and the API rejects a conversation starting on assistant.
  while (kept.length && kept[0].role !== "user") kept.shift();
  if (!kept.length) {
    return { ok: false, messages: [], warnings, error: "Conversation must contain a user message" };
  }
  if (kept[kept.length - 1].role !== "user") {
    return {
      ok: false,
      messages: [],
      warnings,
      error: "Conversation must end with a user message",
    };
  }

  if (kept.length > LIMITS.maxMessages) {
    kept.splice(0, kept.length - LIMITS.maxMessages);
    while (kept.length && kept[0].role !== "user") kept.shift();
    warnings.push("Older messages were dropped to stay within the turn limit");
  }

  // Context budget: drop the oldest turns rather than truncating the newest
  // one, because the recent exchange is what makes the reply coherent.
  let total = kept.reduce((n, m) => n + m.content.length, 0);
  while (kept.length > 1 && total > LIMITS.maxTotalChars) {
    total -= kept[0].content.length;
    kept.shift();
    while (kept.length && kept[0].role !== "user") kept.shift();
    if (warnings.indexOf("Older messages were dropped to stay within the context limit") === -1) {
      warnings.push("Older messages were dropped to stay within the context limit");
    }
  }
  if (!kept.length || kept[0].role !== "user") {
    return { ok: false, messages: [], warnings, error: "Conversation is too large to process" };
  }

  return { ok: true, messages: kept, warnings };
}

// Billing and key-configuration failures are worth falling back from: the user
// still gets a usable answer and we do not leak provider errors at them.
function isFallbackable(err) {
  const msg = String((err && err.message) || "").toLowerCase();
  return Boolean(
    err &&
      (err.status === 400 ||
        err.status === 401 ||
        err.status === 402 ||
        err.status === 403 ||
        err.status >= 500 ||
        msg.includes("credit balance") ||
        msg.includes("scope to a workspace") ||
        msg.includes("api key") ||
        msg.includes("workspace"))
  );
}

async function chat({ messages, signal } = {}) {
  const check = sanitizeMessages(messages);
  if (!check.ok) {
    const err = new Error(check.error);
    err.status = 400;
    throw err;
  }

  const forceStub = String(process.env.AI_STUB || "").toLowerCase() === "true";
  if (forceStub || !ai.isConfigured()) {
    const res = await chatStub({ messages: check.messages, signal });
    return { ...res, warnings: check.warnings };
  }

  try {
    const res = await ai.complete({
      system: SYSTEM_PROMPT,
      messages: check.messages,
      maxTokens: 1024,
      signal,
    });
    return {
      ok: true,
      reply: res.text.slice(0, LIMITS.maxReplyChars),
      model: res.model,
      usage: res.usage,
      warnings: check.warnings,
    };
  } catch (err) {
    if (String(process.env.AI_STUB_FALLBACK || "true").toLowerCase() !== "false" && isFallbackable(err)) {
      const res = await chatStub({ messages: check.messages, signal });
      res._fallback = { reason: err.message, status: err.status || null };
      res.warnings = check.warnings;
      return res;
    }
    throw err;
  }
}

module.exports = { chat, sanitizeMessages, SYSTEM_PROMPT, LIMITS };
