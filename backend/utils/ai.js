// Minimal Anthropic Messages API client.
//
// Deliberately dependency-free: this project ships as plain Node with no
// package install step, and `fetch` is all a single Messages call needs. It
// exists so every AI call site goes through one place that enforces the things
// that are easy to forget -- the API key stays server-side, requests have a
// timeout, output is token-capped, and a missing key produces a clear error
// instead of a confusing 401 from the API.
//
// Nothing here should ever be required from a browser-side script.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

// Confirm this against the models available to the account. Anthropic aliases
// move over time, and a wrong id here fails every AI feature at once.
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 180000);
const DEFAULT_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 16000);

// A single user-facing action must never be able to spend unbounded money.
// Every call passes through here, so this is the backstop for the whole app.
const MAX_OUTPUT_TOKENS_CEILING = 64000;

function apiKey() {
  return String(process.env.ANTHROPIC_API_KEY || "").trim();
}

// Console-issued keys can be scoped to a workspace. When they are, the API
// refuses calls that do not name the workspace, so the header has to travel
// with every request. Unscoped keys ignore it, which is why this is safe to
// send unconditionally when set.
function workspaceId() {
  return String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim();
}

function isConfigured() {
  return apiKey().length > 0;
}

function model() {
  return String(process.env.ANTHROPIC_MODEL || "").trim() || DEFAULT_MODEL;
}

function maxTokens(requested) {
  const want = Number(requested) || DEFAULT_MAX_TOKENS;
  if (want <= 0) return DEFAULT_MAX_TOKENS;
  return Math.min(want, MAX_OUTPUT_TOKENS_CEILING);
}

class AiError extends Error {
  constructor(message, { status = null, detail = null, retryable = false } = {}) {
    super(message);
    this.name = "AiError";
    this.status = status;
    this.detail = detail;
    this.retryable = retryable;
  }
}

// Pull the assistant text out of the content blocks. The API returns an array
// and may include non-text blocks; taking the first text block is not enough
// because thinking blocks can precede it.
function extractText(payload) {
  const blocks = Array.isArray(payload && payload.content) ? payload.content : [];
  return blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
}

function usageOf(payload) {
  const u = (payload && payload.usage) || {};
  return {
    inputTokens: Number(u.input_tokens) || 0,
    outputTokens: Number(u.output_tokens) || 0,
  };
}

/**
 * Single Messages call.
 *
 * @param {object} opts
 * @param {string} [opts.system]  System prompt.
 * @param {string} opts.prompt    The user turn.
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text: string, usage: object, model: string, stopReason: string}>}
 */
async function complete({ system, prompt, maxTokens: want, timeoutMs, signal } = {}) {
  if (!isConfigured()) {
    throw new AiError(
      "ANTHROPIC_API_KEY is not set. AI features are disabled until it is configured."
    );
  }
  const userText = String(prompt || "").trim();
  if (!userText) throw new AiError("AI prompt is empty");

  const budget = maxTokens(want);
  const timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;

  // Combine an external abort signal with our own timeout so a caller can
  // cancel early and we still cannot hang forever.
  const ctl = new AbortController();
  const onExternalAbort = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), timeout);

  const body = {
    model: model(),
    max_tokens: budget,
    messages: [{ role: "user", content: userText }],
  };
  if (system) body.system = String(system);

  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey(),
    "anthropic-version": API_VERSION,
  };
  const ws = workspaceId();
  if (ws) headers["anthropic-workspace-id"] = ws;

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal: ctl.signal,
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const aborted = ctl.signal.aborted;
    throw new AiError(
      aborted
        ? `AI request timed out after ${timeout}ms`
        : `AI request failed: ${err.message}`,
      { retryable: !aborted }
    );
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }

  const raw = await res.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail =
      (payload && payload.error && payload.error.message) || raw || `HTTP ${res.status}`;
    // 429 and 5xx are worth another attempt; a 400 means the request is wrong
    // and retrying it unchanged just burns the same money again.
    const retryable = res.status === 429 || res.status >= 500;
    throw new AiError(`AI provider rejected the request (${res.status}): ${detail}`, {
      status: res.status,
      detail,
      retryable,
    });
  }

  const text = extractText(payload);
  if (!text) {
    throw new AiError("AI provider returned an empty response", {
      status: res.status,
      detail: (payload && payload.stop_reason) || null,
    });
  }

  return {
    text,
    usage: usageOf(payload),
    model: (payload && payload.model) || model(),
    stopReason: (payload && payload.stop_reason) || null,
  };
}

/**
 * Ask for a single JSON object and return it parsed.
 *
 * Models wrap JSON in prose or fences often enough that a bare JSON.parse is
 * not a real strategy. This prefers a fenced block, then the outermost
 * brace-matched span, and reports clearly when neither is present.
 */
async function completeJson(opts = {}) {
  const res = await complete(opts);
  const parsed = parseJsonLoose(res.text);
  if (!parsed) {
    throw new AiError("AI response was not valid JSON", {
      detail: res.text.slice(0, 300),
    });
  }
  return { data: parsed, usage: res.usage, model: res.model, stopReason: res.stopReason };
}

function parseJsonLoose(text) {
  const src = String(text || "").trim();
  if (!src) return null;

  try {
    return JSON.parse(src);
  } catch {
    /* fall through to fence extraction */
  }

  const fenced = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through to brace matching */
    }
  }

  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(src.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = {
  complete,
  completeJson,
  parseJsonLoose,
  isConfigured,
  workspaceId,
  model,
  maxTokens,
  extractText,
  AiError,
  DEFAULT_MODEL,
  MAX_OUTPUT_TOKENS_CEILING,
};