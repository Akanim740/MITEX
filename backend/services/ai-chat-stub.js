// Offline fallback for chat, used while there are no API credits or no key.
//
// A stub for a chat window has one trap: the temptation to sound helpful by
// making things up. So every MITEX-specific claim in here is a fact taken from
// this codebase -- what the Builder actually does, what the download flow
// actually is -- and anything it does not know (prices, turnaround, staff,
// availability) it declines to state and points at a real page instead.
//
// It is rule-based rather than a canned string so that it is genuinely useful
// in the state it will actually ship in: credits at zero. It also reads the
// whole conversation, not just the last message, so a short follow-up like
// "how do I get it?" is answered from the topic that was already being
// discussed instead of bouncing to the generic fallback.

const PAGES = {
  packages: "/packages.html",
  marketplace: "/marketplace.html",
  builder: "/ai-builder.html",
  video: "/video-generator.html",
  careers: "/careers.html",
};

const REPLIES = {
  greeting:
    "Hello - I'm the MITEX assistant. I can walk you through the AI Builder, the marketplace, the video generator, or answer general web questions. What are you working on?",
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
  payment:
    "When a build is approved, you place an order for it from the project page. Once payment is confirmed by the MITEX team the project is released, and that's when the download becomes available - you get a ZIP with the full site source. Paying and what a project costs are handled on the packages page at " +
    PAGES.packages +
    "; I won't quote figures here.",
  download:
    "A released project downloads as a ZIP from the project page. Inside is the complete source - the HTML pages, the stylesheet and the JavaScript - ready to open locally or upload to a host.",
  review:
    "After a build is generated, the project goes through a review step before it's released and downloadable. I can't promise how long that takes - that's the team's call - but every status change shows up on the project page.",
  edit:
    "Generated sites are plain files, so nothing is locked in. Tell the Builder what you want changed - copy, colours, sections, pages - and rebuild with that note; the updated files land back in the project.",
  account:
    "Your account is at /account.html, you can sign in at /login.html, and a new account is created at /register.html.",
  refund:
    "The refund policy lives at /refund.html - that page is the source of truth and I won't paraphrase policy into a promise.",
  about:
    "MITEX is a marketplace for ready-made websites, with an AI Builder that generates a complete static site from a brief, an AI Video Generator, and this assistant. The marketplace at " +
    PAGES.marketplace +
    ", the Builder at " +
    PAGES.builder +
    " and the video tool at " +
    PAGES.video +
    " each say more than I can.",
  help:
    "I can explain how the AI Builder, the marketplace, the video generator, packages and hosting work, and answer general web questions - HTML, CSS, JavaScript, accessibility, SEO, performance. Ask me about any of those.",
  tech:
    "Generated sites are self-contained static HTML, CSS and vanilla JavaScript - no build step, no framework, nothing to install. You can open index.html right from the folder, or upload the whole thing to any static host.",
  fallback:
    "I can't give you a reliable answer to that right now, and I'd rather say so than invent one. Try the AI Builder at " +
    PAGES.builder +
    " for site work, the packages page at " +
    PAGES.packages +
    " for what's on offer, or ask me how the Builder, the marketplace or the video generator works.",
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
    test: /\b(validation|required|pattern\b|input type)\b/,
    reply:
      "Validate before submit: each field needs a <label> and the right type (email, tel, url), required is only the start - add pattern and maxlength where the format matters, and show a clear inline error message rather than a browser tooltip alone.",
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
  {
    test: /\b(git|github|repository|repo|commit|version control)\b/,
    reply:
      "Make a commit before you change anything, branch when a change is experimental, and keep the commit message in the present tense summary form. Push early - the remote is your backup.",
  },
  {
    test: /\b(image\b|images|pictures|photo|svg|png|jpg|jpeg)\b/,
    reply:
      "Serve images at the size they're displayed: resize before upload, compress to webp where you can, and always give meaningful images alt text. Inline SVG is the right choice for icons and simple graphics because it stays crisp at any size.",
  },
  {
    test: /\b(speed|slow|fast|performance|load time|lazy ?load|bundle)\b/,
    reply:
      "Perceived speed is mostly: minimal blocking scripts, no giant images, and honest caching headers on a host that does them for you. Lazy-load below-the-fold images, and keep above-the-fold CSS small.",
  },
  {
    test: /\b(dark mode|theme|light mode|prefers-color-scheme)\b/,
    reply:
      "Use CSS custom properties for all colours, then flip the values in a prefers-color-scheme media query - that gives you dark and light mode for almost free. Keep contrast solid in both, never pure black on pure white.",
  },
  {
    test: /\b(semantic|nav tag|section|article|aside|main tag|heading)\b/,
    reply:
      "Choose elements for meaning, not appearance: <header>, <nav>, <main>, <section>, <article>, <aside> and <footer> tell browsers and screen readers what a page is made of. Match them to an h1-h6 outline that reads like a table of contents.",
  },
  {
    test: /\b(menu|hamburger|navigation|nav bar|sticky nav)\b/,
    reply:
      "A small-screen menu needs three things to stay accessible: a real <button> (not a div) that toggles it, a visible focus style, and the menu collapsing off-screen or into aria-expanded state rather than being hidden with display:none.",
  },
  {
    test: /\b(contrast|wcag|colour ?blind|color ?blind)\b/,
    reply:
      "Text needs strong contrast against its background - body text especially. Check at 360px zoom too: WCAG failures usually show up as small, low-contrast links that are only discoverable on hover.",
  },
  {
    test: /\b(favicon|site icon)\b/,
    reply:
      "A favicon is just a small icon file linked from every page - favicon.ico plus a 180px apple-touch-icon covers most browsers. A single SVG icon file covers the modern ones.",
  },
];

const VIDEO_WORDS = /\b(video|gif|animation|animate|reel|slideshow|intro)\b/;
// Plurals and verb forms matter: "what are your fees?", "do you do refunds?",
// "when will it be reviewed?" are the forms people actually type, and a bare
// \bfee\b or \breview\b misses all of them.
const PRICING_WORDS = /\b(prices?|pricing|costs?|how much|quotes?|budget|fees?|charges?|afford|naira|₦|\bngn\b)\b/;
const BUILDER_WORDS = /\b(build|builder|ai builder|generate|generat|website|site|landing page|web page|redesign)\b/;
const MARKET_WORDS = /\b(marketplace|buy|purchase|templates?|ready-made|ready made|browse|listings?)\b/;
const HOST_WORDS = /\b(host\w*|deploy\w*|domain\w*|go live|put it live|publish\w*|server\w*|static host)\b/;
const CAREER_WORDS = /\b(jobs?|career\w*|hiring|vacanc\w*|apply\w* for|work with you|employment)\b/;
const PAYMENT_WORDS = /\b(pay\w*|paid|billing|invoice\w*|checkout\w*)\b/;
const DOWNLOAD_WORDS = /\b(download\w*|zip|receive the files|get the files|get my site|get my website)\b/;
const REVIEW_WORDS = /\b(review\w*|approv\w*|is it ready|checked over)\b/;
const EDIT_WORDS = /\b(edit\w*|chang\w*|modif\w*|updat\w*|customi[sz]\w*|make it (?:different|better|bigger|cleaner))\b/;
const ACCOUNT_WORDS = /\b(log\w*\s*in|log out|sign\w*\s*in|sign\w*\s*up|register\w*|account\w*)\b/;
const REFUND_WORDS = /\b(refund\w*|money ?back|guarantee\w*)\b/;
const ABOUT_WORDS = /\b(who are you|what is mitex|what['’]s mitex|about mitex|tell me about yourself|what do you do)\b/;
const HELP_WORDS = /\b(what can you do|help me|commands?|list of things)\b/;
const TECH_WORDS = /\b(tech stack|built with|made of|plain html|vanilla js|what are the files)\b/;
const GREETING = /^(hi+|hello+|hey+|yo+|howdy|good (morning|afternoon|evening|day)|sup|greetings)\b[\s!.,?]*$/i;
const THANKS = /\b(thanks|thank you|cheers|appreciate|got it|perfect|great)\b/i;

// Replies for short, context-dependent follow-ups ("how do I get it?") that
// only make sense against the topic from earlier in the conversation.
const FOLLOWUPS = {
  pricing:
    "For a figure, the packages page at " +
    PAGES.packages +
    " is the source of truth, and the MITEX team can quote exactly for the site you're building. I won't guess a number here.",
  builder:
    "For the AI Builder: describe the site you want, it generates the files, the project goes through review, and once the order is confirmed paid it's released for you to download as a ZIP. Start at " +
    PAGES.builder +
    ".",
  video:
    "The video generator is at " +
    PAGES.video +
    "- you write a short brief and choose the aspect ratio and duration in the form, then it renders a GIF to download.",
  marketplace:
    "You can browse and buy those at " +
    PAGES.marketplace +
    ". I can't see live stock or pricing - the listing itself is the source of truth.",
  host:
    "Open the folder in a browser, or upload it to any static host that serves HTML - then attach your domain and turn on HTTPS there.",
  careers:
    "Open roles are at " +
    PAGES.careers +
    " - I don't have hiring status or timelines to share.",
  payment:
    "Order the build from the project page, MITEX confirms the payment, the project is released, and the download opens up as a ZIP. Figures and payment options are on the packages page at " +
    PAGES.packages +
    " - I don't quote them here.",
  download:
    "Once a project is released, download it from the project page as a ZIP of the full source - pages, stylesheet and scripts.",
};

function matchWebTip(text) {
  for (const tip of WEB_TIPS) if (tip.test.test(text)) return tip.reply;
  return null;
}

// Resolve a single message to an intent key. The order is deliberate: the
// specific MITEX topics come before the broad web tips, and the generic
// builder words come after the tips so "make my site responsive" answers the
// real question instead of pitching the Builder.
function intentOf(text) {
  const q = text.trim().toLowerCase();
  if (!q || GREETING.test(q)) return "greeting";
  if (PRICING_WORDS.test(q)) return "pricing";
  if (VIDEO_WORDS.test(q)) return "video";
  if (CAREER_WORDS.test(q)) return "careers";
  if (MARKET_WORDS.test(q)) return "marketplace";
  if (HOST_WORDS.test(q)) return "host";
  if (PAYMENT_WORDS.test(q)) return "payment";
  if (DOWNLOAD_WORDS.test(q)) return "download";
  if (REVIEW_WORDS.test(q)) return "review";
  if (EDIT_WORDS.test(q)) return "edit";
  if (ACCOUNT_WORDS.test(q)) return "account";
  if (REFUND_WORDS.test(q)) return "refund";
  if (ABOUT_WORDS.test(q)) return "about";
  if (HELP_WORDS.test(q)) return "help";
  if (TECH_WORDS.test(q)) return "tech";
  if (matchWebTip(q)) return "tip";
  if (BUILDER_WORDS.test(q)) return "builder";
  if (THANKS.test(q) && q.length < 60) return "thanks";
  return "fallback";
}

function replyFor(key, text, tip) {
  if (key === "greeting") return REPLIES.greeting;
  if (key === "tip" || tip) return tip ? tip : REPLIES.fallback;
  return REPLIES[key] || REPLIES.fallback;
}

// A short, vague follow-up ("and then?", "how do I get it?") should be read
// against the topic the conversation was already on, not bounced to fallback.
function isWeakFollowUp(text) {
  const t = text.trim();
  if (!t || t.length > 48) return false;
  return /^(and|so|ok|okay|then|but|what about|how do|how does|why|elaborate|explain|tell me more|more detail)\b/i.test(
    t
  );
}

/**
 * Produce a reply from the conversation. Returns the same shape as chat().
 */
async function chatStub({ messages } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const userMessages = list.filter((m) => m && m.role === "user").map((m) => String(m.content || ""));
  const lastText = userMessages[userMessages.length - 1] || "";
  const prevText = userMessages.length > 1 ? userMessages[userMessages.length - 2] : "";

  let key = intentOf(lastText);
  let reply;

  if (
    key === "fallback" &&
    isWeakFollowUp(lastText) &&
    prevText &&
    intentOf(prevText) !== "fallback" &&
    FOLLOWUPS[intentOf(prevText)]
  ) {
    reply = FOLLOWUPS[intentOf(prevText)];
  } else if (key === "tip") {
    reply = matchWebTip(lastText);
  } else {
    reply = replyFor(key, lastText);
  }

  return {
    ok: true,
    reply,
    model: "stub/mitex-chat",
    // Zeroed rather than absent: the UI reads these and a missing field would
    // render as "undefined tokens".
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

module.exports = { chatStub, REPLIES, PAGES, FOLLOWUPS, intentOf };