// Offline fallback for chat, used while there are no API credits or no key.
//
// A stub for a chat window has one trap: the temptation to sound helpful by
// making things up. So every MITEX-specific claim in here is a fact taken from
// this codebase -- what the Builder actually does, what the download flow
// actually is -- and anything it does not know (prices, turnaround, staff,
// availability) it declines to state and points at a real page instead.
//
// It is rule-based rather than a canned string so that it is genuinely useful
// in the state it will actually ship in: credits at zero.

const PAGES = {
  packages: "/packages.html",
  marketplace: "/marketplace.html",
  builder: "/ai-builder.html",
  video: "/video-generator.html",
  careers: "/careers.html",
};

const REPLIES = {
  greeting:
    "Hello - I'm the MITEX assistant. I can walk you through the AI Builder, the marketplace, or answer general web questions. What are you working on?",
  thanks: "You're welcome. Anything else about MITEX or the site you're building?",
  pricing:
    "I don't have MITEX's pricing to hand and I'd rather not guess at a figure that could be wrong. See the current packages at " +
    PAGES.packages +
    ", or contact MITEX directly for a quote.",
  builder:
    "The AI Builder turns a written brief into a working static site. You describe the pages, style and content you want, it generates plain HTML, CSS and JavaScript, you review it, approve it, pay, then download the ZIP. Start at " +
    PAGES.builder +
    ".",
  video:
    "The AI Video Generator is at " +
    PAGES.video +
    ". You write a short brief, choose an aspect ratio and how long it should run, and it renders a GIF you can download.",
  marketplace:
    "The marketplace at " +
    PAGES.marketplace +
    " is where ready-made sites are listed - browse what's there, then buy and download.",
  careers:
    "Open roles are listed at " +
    PAGES.careers +
    ". I don't have hiring status or timelines to share.",
  host:
    "A generated site is plain HTML, CSS and JavaScript with no build step, so it runs anywhere: open index.html to preview it locally, or upload the whole folder to any static host. To put it on the public web you'll also want a domain and HTTPS.",
  fallback:
    "I can't give you a reliable answer to that right now, and I'd rather say so than invent one. Try the AI Builder at " +
    PAGES.builder +
    " for site work, the packages page at " +
    PAGES.packages +
    " for what's on offer, or ask me how the Builder or the marketplace works.",
};

const WEB_TIPS = [
  {
    test: /\b(responsive|mobile|media quer|breakpoint|viewport)\b/,
    reply:
      "Build mobile-first: one column on small screens, then add media queries as space allows. Use relative units (rem, %, clamp()) instead of fixed pixels, and test at 360px wide as well as desktop.",
  },
  {
    test: /\b(accessib|a11y|screen reader|aria|alt text|focus)\b/,
    reply:
      "The parts that matter most: a lang attribute on <html>, a real <title>, one h1, a label tied to every form control, alt text on meaningful images, and a focus style you can actually see. Those cover the majority of real-world issues.",
  },
  {
    test: /\b(flexbox|flex box|\bgrid\b|layout)\b/,
    reply:
      "Reach for flexbox when content flows in one direction (a nav bar, a row of cards), and grid when you're placing things in two dimensions (a page section, a card gallery). You rarely need both for the same container.",
  },
  {
    test: /\b(seo|meta description|sitemap|robots|ranking|google)\b/,
    reply:
      "On a static site, SEO comes down to: a unique title and meta description per page, exactly one h1, a logical heading order, descriptive alt text, a robots.txt and a sitemap. Structured content and fast load times do the rest.",
  },
  {
    test: /\b(form|contact form|submit|email field)\b/,
    reply:
      "HTML alone can't receive a submission - a form needs somewhere to send it. On a static site that means either a hosted form endpoint or a small serverless function. The markup side is straightforward: associate every input with a <label> and validate before submit.",
  },
  {
    test: /\b(javascript|js|vanilla|event listener|dom)\b/,
    reply:
      "For a static site, vanilla JS is usually enough: select the element, attach an event listener, update the DOM. Reach for a framework only when the state you're managing has genuinely outgrown that.",
  },
  {
    test: /\b(css|style|stylesheet|colour|color|font|typography)\b/,
    reply:
      "Two things lift a stylesheet the most: a small type scale with a real hierarchy, and consistent spacing from a limited set of values. Define them as CSS custom properties at :root and the whole page stays coherent.",
  },
  {
    test: /\b(ssl|https|certificate|secure)\b/,
    reply:
      "HTTPS is standard on hosted platforms now - most static hosts enable it automatically with a managed certificate. Self-hosting means getting a certificate from your provider and making sure every asset URL is absolute-path so nothing mixed-content breaks.",
  },
];

const VIDEO_WORDS = /\b(video|gif|animation|animate|reel|slideshow|intro)\b/;
// Plurals matter: "what are your fees?" and "how much are the prices?" are the
// forms people actually type, and \bfee\b misses "fees".
const PRICING_WORDS = /\b(prices?|pricing|costs?|how much|quotes?|budget|fees?|charges?|afford|naira|₦|\bngn\b|\$)\b/;
const BUILDER_WORDS = /\b(build|builder|ai builder|generate|generat|website|site|landing page|web page|redesign)\b/;
const MARKET_WORDS = /\b(marketplace|buy|purchase|templates?|ready-made|ready made|browse|listings?)\b/;
const HOST_WORDS = /\b(host|hosting|deploy|deployment|domain|go live|put it live|publish|server|static host)\b/;
const CAREER_WORDS = /\b(job|career|hiring|vacanc|apply for|work with you|employment)\b/;
const GREETING = /^(hi+|hello+|hey+|yo+|howdy|good (morning|afternoon|evening|day)|sup|greetings)\b[\s!.,?]*$/i;
const THANKS = /\b(thanks|thank you|cheers|appreciate|got it|perfect|great)\b/i;

function matchWebTip(text) {
  for (const tip of WEB_TIPS) if (tip.test.test(text)) return tip.reply;
  return null;
}

/**
 * Produce a reply from the conversation. Returns the same shape as chat().
 */
async function chatStub({ messages } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const lastUser = [...list].reverse().find((m) => m && m.role === "user");
  const text = String((lastUser && lastUser.content) || "").trim();
  const q = text.toLowerCase();
  const tip = matchWebTip(q);

  let reply;
  if (!text || GREETING.test(q)) reply = REPLIES.greeting;
  else if (PRICING_WORDS.test(q)) reply = REPLIES.pricing;
  else if (VIDEO_WORDS.test(q)) reply = REPLIES.video;
  else if (CAREER_WORDS.test(q)) reply = REPLIES.careers;
  else if (MARKET_WORDS.test(q)) reply = REPLIES.marketplace;
  else if (HOST_WORDS.test(q)) reply = REPLIES.host;
  // Specific web questions come before the broad builder intent. "How do I
  // make my site responsive?" contains "site", so answering it with the Builder
  // pitch would ignore the question the user actually asked.
  else if (tip) reply = tip;
  else if (BUILDER_WORDS.test(q)) reply = REPLIES.builder;
  else if (THANKS.test(q) && q.length < 60) reply = REPLIES.thanks;
  else reply = REPLIES.fallback;

  return {
    ok: true,
    reply,
    model: "stub/mitex-chat",
    // Zeroed rather than absent: the UI reads these and a missing field would
    // render as "undefined tokens".
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

module.exports = { chatStub, REPLIES, PAGES };
