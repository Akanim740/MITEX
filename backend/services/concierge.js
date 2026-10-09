// The MITEX tour guide - the site-wide assistant every visitor sees.
//
// Where /api/chat is a signed-in utility ("answer my question"), concierge is
// a guest-facing host: it greets someone the moment they land, tells them what
// the page they are on can do, and answers questions with the same honesty
// rules as chat. It does not need an account, because the worst outcome for a
// first-time visitor is being asked to sign up before a single question is
// answered.
//
// Same discipline as ai-chat.js: bounded context, no invented facts, and a
// stub that is still genuinely useful because credits sit at zero right now.

const provider = require("./ai-provider");
const { sanitizeMessages, LIMITS } = require("./ai-chat");
const { chatStub, intentOf } = require("./ai-chat-stub");

// Known pages. Anything not in this map gets the generic tour below; the key
// is the file name so the widget can report location.href's path portion.
const PAGES = [
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
const DEFAULT_PAGE = "default";

function normalizePage(raw) {
  const p = String(raw || "")
    .replace(/^.*\//, "") // strip any path
    .replace(/\.html$/, "")
    .replace(/\?.*$/, "")
    .toLowerCase()
    .trim();
  return PAGES.includes(p) ? p : (p && p.length && p !== "default" ? DEFAULT_PAGE : DEFAULT_PAGE);
}

// What the tour guide says about the page the visitor is standing on. These
// double as the system-prompt context (they tell a real model where to point
// someone) and as the stub's instant greeting.
const PAGE_TOURS = {
  index:
    "Welcome to MITEX - I'm your AI tour guide. Around here: the Marketplace lists ready-made websites you can buy and download, the AI Builder turns a written brief into a complete static site, the Video Generator renders a promo clip, and the Playground runs Python or C++ in your browser. What would you like to see first?",
  marketplace:
    "You're on the Marketplace, where ready-made websites are listed. Each listing describes what it includes; you can browse, buy and download. Tell me what kind of site you're after and I'll help you find it.",
  "ai-builder":
    "You're on the AI Builder. Describe the site you want - pages, style, colours, content - and it generates the HTML, CSS and JavaScript. You can type your brief above and start right away; a quick tip, 'what are you building today?' works well.",
  "video-generator":
    "You're on the Video Generator. You describe the clip you want, pick its shape and length, and it renders a GIF to download. Try something like 'a 10-second intro for a coffee shop'.",
  chat:
    "You're already in the Assistant. Ask me about the AI Builder, the marketplace, the video generator, packages, hosting, or any web question - HTML, CSS, JavaScript, SEO, accessibility.",
  "code-playground":
    "You're on the Playground - Python and C++ run right in the browser. Pick a language, type or paste code, and press Run. Want an example to try?",
  packages:
    "You're on Packages, where MITEX's plans are laid out. I won't quote figures - the page is the source of truth - but I can explain what's included and how payments work.",
  careers:
    "You're on Careers, where open roles are listed. I don't have hiring status or timelines to share, but the page has the current openings and application steps.",
  account:
    "You're on your Account page - your AI projects, orders and downloads live here.",
  default:
    "Welcome to MITEX - I'm your AI tour guide. The Marketplace has ready-made websites, the AI Builder generates one from your brief, and the Video Generator makes promo clips. Where would you like to go?",
};

// Greeting + tour prompts. "what can I do here" / "show me around" etc. are
// how real people ask for a tour and should earn the page-specific tour, not
// the generic fallback.
const TOUR_WORDS =
  /\b(walk me around|walk me through|tour|show me around|show me what|what can i do (here|on this page)|what is this page|get(ting)? started|guide me|where am i|explain this page|what's on this page|whats on this page)\b/i;

function stubReply({ sorted, lastText, page }) {
  const key = intentOf(lastText);
  const tourKey = normalizePage(page);
  const tour = PAGE_TOURS[tourKey] || PAGE_TOURS.default;
  const wantTour =
    TOUR_WORDS.test(lastText) || /^(hi+|hello+|hey+|yo+)\b[\s!.,?]*$/i.test(lastText.trim());
  if (wantTour) {
    return {
      ok: true,
      reply: tour + "\n\nAs a reminder: I don't guess MITEX prices or timelines - I'll point you at the right page instead.",
      model: "stub/mitex-concierge",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
  // Everything else reuses the chat stub's intents and follow-ups.
  return chatStub({ messages: sorted });
}

const SYSTEM_PROMPT = [
  "You are the MITEX concierge - an exceptionally friendly AI tour guide for",
  "visitors on the MITEX website, a marketplace for ready-made websites with an",
  "AI Builder (brief to complete static site), an AI Video Generator (brief to",
  "GIF), a browser code Playground, and this assistant.",
  "",
  "Your job on first contact is to act as a tour guide: warmly welcome the",
  "visitor, tell them what the page they are on can do, and offer one clear next",
  "step. Keep that first reply short, warm and concrete.",
  "",
  "Pages - write them as paths so the visitor can open them:",
  "- Marketplace (ready-made sites): /marketplace.html",
  "- Packages (what is on offer): /packages.html",
  "- AI Builder: /ai-builder.html",
  "- Video Generator: /video-generator.html",
  "- Playground (run Python/C++ in the browser): /code-playground.html",
  "- Assistant (full chat): /chat.html",
  "- Account: /account.html",
  "- Careers: /careers.html",
  "",
  "Project flow (state it, never improve on it):",
  "- The AI Builder turns a written brief into plain HTML, CSS and JavaScript.",
  "- A build is reviewed, then ordered and confirmed, only then released and",
  "  available to download as a ZIP.",
  "",
  "Behaviour rules:",
  "- Never invent facts. No prices, discounts, delivery times, availability,",
  "  statistics, testimonials or awards unless the visitor put them in front of",
  "  you. Refuse politely and point at the right page instead of guessing.",
  "- You cannot browse, send email, charge a card or run commands - say so when",
  "  a visitor implies otherwise, then give the correct page for the action.",
  "- Answer the question actually asked. If someone asks you to build or price",
  "  something, ask the two or three clarifying questions that would change the",
  "  outcome, then give one concrete next step.",
  "- Be direct and concise. A few warm sentences, plain text only, no HTML.",
  "  Use '-' for lists and ``` fences for short code snippets.",
  "- General web questions (HTML, CSS, JavaScript, hosting, domains, AI,",
  "  responsiveness, accessibility, SEO) you can answer fully and accurately.",
  "- If a request is harmful, illegal or asks you to break something, decline",
  "  briefly and offer the legitimate alternative.",
  "- If unsure, say so. Never guess a fact about MITEX.",
].join("\n");

function pageContext(page) {
  const key = normalizePage(page);
  return key === DEFAULT_PAGE
    ? "The visitor's page is not one we have a tour for; use the generic welcome."
    : `The visitor is on the ${key} page right now. Their opening line: the page tour above.`;
}

/**
 * Answer one visitor turn.
 *
 * @param {object} opts
 * @param {Array<{role:string, content:string}>} opts.messages  conversation
 * @param {string} [opts.page]  page slug the visitor is on
 * @returns {Promise<{ok:boolean, reply:string, model:string, usage:object}>}
 */
async function concierge({ messages, page, signal } = {}) {
  const check = sanitizeMessages(messages);
  if (!check.ok) {
    const err = new Error(check.error);
    err.status = 400;
    throw err;
  }
  const key = normalizePage(page);

  const forceStub = String(process.env.AI_STUB || "").toLowerCase() === "true";
  if (forceStub || !provider.isConfigured()) {
    return stubReply({ sorted: check.messages, lastText: lastUser(check.messages), page: key });
  }

  const system = SYSTEM_PROMPT + "\n\n" + pageContext(key);
  try {
    const res = await provider.complete({
      system,
      messages: check.messages,
      maxTokens: 512,
      signal,
    });
    if (!res) return stubReply({ sorted: check.messages, lastText: lastUser(check.messages), page: key });
    return {
      ok: true,
      reply: res.text.slice(0, LIMITS.maxReplyChars),
      model: `${res.provider}/${res.model}`,
      usage: res.usage,
    };
  } catch (err) {
    if (String(process.env.AI_STUB_FALLBACK || "true").toLowerCase() !== "false") {
      return stubReply({ sorted: check.messages, lastText: lastUser(check.messages), page: key });
    }
    throw err;
  }
}

function lastUser(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].role === "user") return String(list[i].content || "");
  }
  return "";
}

module.exports = { concierge, PAGE_TOURS, normalizePage, SYSTEM_PROMPT };