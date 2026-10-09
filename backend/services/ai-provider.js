// Model provider chain for MITEX AI.
//
// The site is designed to run on a real model but ship as a self-contained
// bundle with no working key: the chat and the concierge both go through this
// file so that whichever key exists earns the job, and the fallbacks kick in
// only when none does.
//
// Priority (first configured wins):
//   1. OpenRouter  (OPENROUTER_API_KEY) - one key, many models, free variants
//   2. Google Gemini (GEMINI_API_KEY)   - generous free tier, tough to exhaust
//   3. Anthropic   (ANTHROPIC_API_KEY)  - original integration
//   4. none        - complete() resolves null so callers use their stub
//
// Every provider returns the same shape as utils/ai.js so downstream code
// never branches on where a reply came from:
//   { text, model, usage: { inputTokens, outputTokens } }

const ai = require("../utils/ai");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

function openRouterKey() {
  return String(process.env.OPENROUTER_API_KEY || "").trim();
}
function geminiKey() {
  return String(process.env.GEMINI_API_KEY || "").trim();
}

function openRouterModel() {
  // Default to a free model so the feature works at zero cost. Override in
  // .env with OPENROUTER_MODEL for a paid model once credits exist.
  return String(process.env.OPENROUTER_MODEL || "").trim() || "meta-llama/llama-3.3-70b-instruct:free";
}
function geminiModel() {
  return String(process.env.GEMINI_MODEL || "").trim() || "gemini-2.0-flash";
}

function isConfigured() {
  return openRouterKey().length > 0 || geminiKey().length > 0 || ai.isConfigured();
}

// A real provider is reachable in principle. A key set but a request that
// fails (dead key, exhausted credits) is a provider problem, not a "nothing is
// configured" state - callers use this to distinguish the two.
function primary() {
  if (openRouterKey()) return "openrouter";
  if (geminiKey()) return "gemini";
  if (ai.isConfigured()) return "anthropic";
  return null;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 180000);

// Shared timeout/abort plumbing, mirroring utils/ai.js, so a single request
// can never hang the server regardless of which provider it hits.
function withTimeout(signal, ms) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), ms);
  return {
    signal: ctl.signal,
    done() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

class ProviderError extends Error {
  constructor(message, { status = null, detail = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.detail = detail;
  }
}

async function readJson(res) {
  const raw = await res.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function completeOpenRouter({ system, messages, maxTokens, timeoutMs, signal }) {
  const timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
  const t = withTimeout(signal, timeout);
  const turns = [];
  if (system) turns.push({ role: "system", content: String(system) });
  for (const m of messages) turns.push({ role: m.role, content: m.content });

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: t.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openRouterKey()}`,
        // OpenRouter asks sites to identify themselves so free-tier abuse can
        // be traced; these headers are optional but trivial to send.
        "HTTP-Referer": String(process.env.APP_URL || "https://mitex.store"),
        "X-Title": "MITEX AI",
      },
      body: JSON.stringify({
        model: openRouterModel(),
        messages: turns,
        max_tokens: Math.max(1, Math.min(Number(maxTokens) || 16000, 64000)),
      }),
    });
    const payload = await readJson(res);
    if (!res.ok) {
      const detail =
        (payload && payload.error && payload.error.message) || (payload && payload.error) || `HTTP ${res.status}`;
      throw new ProviderError(`OpenRouter rejected the request (${res.status}): ${detail}`, {
        status: res.status,
        detail: String(detail),
      });
    }
    const choice = payload && payload.choices && payload.choices[0];
    const text = String((choice && choice.message && choice.message.content) || "").trim();
    if (!text) throw new ProviderError("OpenRouter returned an empty response");
    const u = (payload && payload.usage) || {};
    return {
      text,
      model: payload.model || openRouterModel(),
      usage: {
        inputTokens: Number(u.prompt_tokens) || 0,
        outputTokens: Number(u.completion_tokens) || 0,
      },
    };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`OpenRouter request failed: ${err.message}`, {
      status: t.signal.aborted ? 408 : null,
      detail: t.signal.aborted ? "timeout" : String(err.message),
    });
  } finally {
    t.done();
  }
}

async function completeGemini({ system, messages, maxTokens, timeoutMs, signal }) {
  const timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
  const t = withTimeout(signal, timeout);
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body = {
    contents,
    generationConfig: { maxOutputTokens: Math.max(1, Math.min(Number(maxTokens) || 16000, 64000)) },
  };
  if (system) body.systemInstruction = { parts: [{ text: String(system) }] };

  try {
    const url = `${GEMINI_URL}/${geminiModel()}:generateContent?key=${encodeURIComponent(geminiKey())}`;
    const res = await fetch(url, {
      method: "POST",
      signal: t.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readJson(res);
    if (!res.ok) {
      const err = payload && payload.error;
      const detail = (err && err.message) || `HTTP ${res.status}`;
      throw new ProviderError(`Gemini rejected the request (${res.status}): ${detail}`, {
        status: res.status,
        detail: String(detail),
      });
    }
    const parts =
      (payload &&
        payload.candidates &&
        payload.candidates[0] &&
        payload.candidates[0].content &&
        payload.candidates[0].content.parts) ||
      [];
    const text = parts
      .filter((p) => p && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();
    if (!text) throw new ProviderError("Gemini returned an empty response");
    const um = (payload && payload.usageMetadata) || {};
    return {
      text,
      model: payload.modelVersion || payload.model || geminiModel(),
      usage: {
        inputTokens: Number(um.promptTokenCount) || 0,
        outputTokens: Number(um.candidatesTokenCount) || 0,
      },
    };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`Gemini request failed: ${err.message}`, {
      status: t.signal.aborted ? 408 : null,
      detail: t.signal.aborted ? "timeout" : String(err.message),
    });
  } finally {
    t.done();
  }
}

/**
 * One chat completion from whichever provider is configured.
 *
 * @returns {Promise<{text, model, usage, provider}>} or null when no real
 *   provider is configured. Throws ProviderError on provider failure - the
 *   caller decides whether to fall back to its stub.
 */
async function complete({ system, prompt, messages, maxTokens, timeoutMs, signal } = {}) {
  const which = primary();
  if (!which) return null;

  // Keep parity with utils/ai.js: accept either a bare prompt or a
  // conversation, and never forward an empty turn.
  let turns = null;
  if (Array.isArray(messages) && messages.length) {
    turns = [];
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
      if (!role) continue;
      const content = typeof m.content === "string" ? m.content.trim() : "";
      if (!content) continue;
      turns.push({ role, content });
    }
    while (turns.length && turns[0].role !== "user") turns.shift();
  }
  if (!turns || !turns.length) {
    const single = String(prompt || "").trim();
    if (!single) throw new ProviderError("AI prompt is empty");
    turns = [{ role: "user", content: single }];
  }

  let res;
  if (which === "openrouter") {
    res = await completeOpenRouter({ system, messages: turns, maxTokens, timeoutMs, signal });
  } else if (which === "gemini") {
    res = await completeGemini({ system, messages: turns, maxTokens, timeoutMs, signal });
  } else {
    res = await ai.complete({ system, messages: turns, maxTokens, timeoutMs, signal });
  }
  return { ...res, provider: which };
}

module.exports = { complete, isConfigured, primary, ProviderError };