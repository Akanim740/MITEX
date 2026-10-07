// api() and isLoggedIn() come from auth.js, which loads first. Re-declaring
// api() here would shadow it and send every message unauthenticated.
//
// Every message is rendered with textContent, never innerHTML. A chat window
// takes arbitrary user input and would otherwise be the easiest XSS hole on
// the site -- someone pasting <img onerror=...> into their own chat only
// matters if that text is ever re-rendered as markup, so it never is.

const STORE_KEY = "mitex_chat_v1";

// Must stay under the app-wide express.json limit of 20kb (server.js:150).
// The server re-validates; this just keeps the user out of a 413.
const SEND_MAX_BYTES = 18000;
const SEND_MAX_TURNS = 12;
const STORED_MAX_TURNS = 60;

let messages = [];
let sending = false;

const thread = () => document.getElementById("thread");
const input = () => document.getElementById("input");

function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

// Keep only what fits in one request. Oldest turns go first because the
// recent exchange is what makes the reply coherent, and the window must still
// open on a user turn or the API rejects it.
function trimForSend(list) {
  let kept = list.slice(-SEND_MAX_TURNS);
  while (kept.length && kept[0].role !== "user") kept.shift();
  while (kept.length > 1 && byteLength(JSON.stringify({ messages: kept })) > SEND_MAX_BYTES) {
    kept.shift();
    while (kept.length && kept[0].role !== "user") kept.shift();
  }
  return kept;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    if (Array.isArray(raw)) {
      messages = raw.filter(
        (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
      );
    }
  } catch {
    messages = [];
  }
}

function persist() {
  if (messages.length > STORED_MAX_TURNS) messages = messages.slice(-STORED_MAX_TURNS);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(messages));
  } catch {
    /* quota exceeded: the conversation still works, it just will not survive a reload */
  }
}

function addBubble(role, text) {
  const empty = document.getElementById("emptyState");
  if (empty) empty.remove();

  const el = document.createElement("div");
  el.className = "msg " + role;
  // textContent, not innerHTML -- see the note at the top of this file.
  el.textContent = text;
  thread().appendChild(el);
  thread().scrollTop = thread().scrollHeight;
  return el;
}

function render() {
  const t = thread();
  t.innerHTML = "";
  if (!messages.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.id = "emptyState";
    p.textContent = "Start the conversation below.";
    t.appendChild(p);
    return;
  }
  for (const m of messages) addBubble(m.role === "user" ? "user" : "assistant", m.content);
}

function setModel(text) {
  document.getElementById("modelBadge").textContent = text;
}

async function send(text) {
  if (sending) return;
  const content = text.trim();
  if (!content) return;

  sending = true;
  const btn = document.getElementById("sendBtn");
  btn.disabled = true;
  btn.textContent = "Sending...";

  messages.push({ role: "user", content });
  render();
  input().value = "";

  const pending = addBubble("assistant pending", "Thinking\u2026");
  pending.classList.add("pending");

  try {
    const res = await api("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: trimForSend(messages) }),
    });

    pending.remove();
    const reply = String((res && res.reply) || "").trim() || "I did not get a reply. Please try again.";
    messages.push({ role: "assistant", content: reply });
    persist();
    render();
    setModel((res && res.model) || "assistant");
    if (Array.isArray(res.warnings) && res.warnings.length) {
      console.info("[chat] warnings:", res.warnings);
    }
  } catch (e) {
    pending.remove();
    addBubble("error", e.message || "That message did not send. Please try again.");
    // The user's message stays in `messages` but is not persisted, so a
    // reload restores the last conversation that actually got a reply.
    render();
  } finally {
    sending = false;
    btn.disabled = false;
    btn.textContent = "Send";
    input().focus();
  }
}

function init() {
  const user = JSON.parse(localStorage.getItem("mitex_user") || "null");
  if (!user || !isLoggedIn()) {
    document.getElementById("loginNote").style.display = "block";
    return;
  }
  document.getElementById("chatPanel").style.display = "grid";

  load();
  render();
  setModel(messages.length ? "conversation restored" : "ready");

  document.getElementById("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    send(input().value);
  });

  input().addEventListener("keydown", (e) => {
    // Enter sends, Shift+Enter inserts a newline -- the convention people
    // already expect, and it keeps multi-line messages possible.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input().value);
    }
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!messages.length) return;
    if (!confirm("Clear this conversation?")) return;
    messages = [];
    persist();
    render();
    setModel("ready");
    input().focus();
  });

  for (const chip of document.querySelectorAll("#suggestions .chipbtn")) {
    chip.addEventListener("click", () => {
      input().value = chip.textContent;
      input().focus();
    });
  }

  input().focus();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
