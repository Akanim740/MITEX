// Zero-cost AI builder stub. Used when ANTHROPIC_API_KEY is absent, or when
// AI_STUB=true. Lets you test the entire MITEX AI flow (projects, payment,
// delivery) without spending API credits.
//
// Where the real model would reason about a brief, this stub reads it for two
// cheap signals and nothing else: *what kind of business* the site is for and
// *what it should be called*. It then assembles a tailored, working multi-page
// static site from that type's palette and sections. A brief that matches no
// type still gets a solid generic business site, so every brief produces
// something usable rather than one fixed template.

const crypto = require("crypto");

// Required lazily, inside the function. ai-builder.js requires this module at
// load time to implement its stub fallback, so a top-level require back into
// ai-builder would be a require cycle and would receive a partially-built
// module.exports where validateBundle is still undefined.
function validator() {
  return require("./ai-builder").validateBundle;
}

function makeId(prefix = "proj") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value, fallback = "site") {
  const s = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || fallback;
}

// ---- brief reading ---------------------------------------------------------

function extractName(brief) {
  const b = String(brief || "");
  // A run of Title-Case words, stopped by a lowercase word or punctuation:
  // "called Golden Crumb Cafe in Lagos" -> "Golden Crumb Cafe".
  let m = b.match(/\b(?:called|named)\s+((?:[A-Z][A-Za-z0-9&.'-]*(?:\s+|$)){1,5})/);
  if (m) return m[1].trim();
  m = b.match(/["']([A-Za-z0-9&' .-]{1,40})["']/);
  if (m) return m[1].trim();
  m = b.match(/\bfor\s+(?:a\s+|an\s+|my\s+)?([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\b/);
  if (m) return m[1].trim();
  return "";
}

// ---- shared page chrome ----------------------------------------------------

function headerNav(pages, name, active) {
  const links = pages
    .map(
      (p) =>
        `<a href="${p.file}"${p.label === active ? ' aria-current="page"' : ""}>${p.label}</a>`
    )
    .join("\n        ");
  return `<header class="header">
    <div class="container header-inner">
      <a class="logo" href="index.html">${escapeHtml(name)}</a>
      <nav class="nav" aria-label="Main">
        ${links}
      </nav>
    </div>
  </header>`;
}

function pageShell({ pages, name, active, title, description, year, main }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
${headerNav(pages, name, active)}
  <main>
${main}
  </main>
  <footer class="footer">
    <div class="container">
      &copy; ${year} ${escapeHtml(name)}. All rights reserved.
    </div>
  </footer>
  <script src="app.js"></script>
</body>
</html>`;
}

function cardList(items) {
  if (!Array.isArray(items) || !items.length) return "";
  const cards = items
    .map((i) => `<div class="card"><h3>${i.h}</h3>${i.p ? `<p>${i.p}</p>` : ""}</div>`)
    .join("\n      ");
  return `<div class="grid">\n      ${cards}\n    </div>`;
}

function section({ kind, kicker, title, lede, items, heading = "h1" } = {}) {
  const tag = heading === "h2" ? "h2" : "h1";
  return `<section class="section container">
    ${kicker ? `<span class="eyebrow">${kicker}</span>` : ""}
    ${title ? `<${tag}${heading === "h2" ? ' class="section-title"' : ""}>${title}</${tag}>` : ""}
    ${lede ? `<p class="lede">${lede}</p>` : ""}
    ${kind === "card" ? cardList(items) : ""}
    ${kind === "list" ? `<ul class="plain-list">${(items || []).map((i) => `<li>${i}</li>`).join("\n      ")}</ul>` : ""}
    ${kind === "timeline" ? `<ol class="timeline">${(items || []).map((i) => `<li><strong>${i.h}</strong>${i.p ? ` - ${i.p}` : ""}</li>`).join("\n      ")}</ol>` : ""}
    ${kind === "gallery" ? `<div class="gallery">${(items || []).map(() => `<div class="ph"><em>[Swapped for a real photo]</em></div>`).join("\n      ")}</div>` : ""}
  </section>`;
}

function heroBlock(h) {
  return `<section class="hero">
    <div class="container">
      ${h.kicker ? `<span class="eyebrow">${h.kicker}</span>` : ""}
      <h1>${h.title}</h1>
      <p class="lede">${h.lede}</p>
      ${h.cta && h.ctaFile ? `<a class="btn" href="${h.ctaFile}">${h.cta}</a>` : ""}
    </div>
  </section>`;
}

// ---- per-destination placeholder copy --------------------------------------

function defaultCardCopy(kind, name) {
  const n = escapeHtml(name);
  const generic = [
    { h: "Service one", p: `[Describe the first core thing ${n} does for customers.]` },
    { h: "Service two", p: `[Describe the second core thing ${n} does for customers.]` },
    { h: "Service three", p: `[Describe the third core thing ${n} does for customers.]` },
  ];
  const sets = {
    menu: [
      { h: "Starters", p: "[List your starter dishes, with a line each.]" },
      { h: "Mains", p: "[List your main courses, with a line each.]" },
      { h: "Desserts & drinks", p: "[List desserts and drinks, with a line each.]" },
    ],
    products: [
      { h: "Category one", p: "[Add a photo and short description of an item.]" },
      { h: "Category two", p: "[Add a photo and short description of an item.]" },
      { h: "Category three", p: "[Add a photo and short description of an item.]" },
    ],
    work: [
      { h: "Project one", p: "[Add a screenshot, the problem, and the result.]" },
      { h: "Project two", p: "[Add a screenshot, the problem, and the result.]" },
      { h: "Project three", p: "[Add a screenshot, the problem, and the result.]" },
    ],
    treatments: [
      { h: "Treatment one", p: "[Describe the treatment and what it is for.]" },
      { h: "Treatment two", p: "[Describe the treatment and what it is for.]" },
      { h: "Treatment three", p: "[Describe the treatment and what it is for.]" },
    ],
    courses: [
      { h: "Course one", p: "[Who it is for, what it covers, any prerequisites.]" },
      { h: "Course two", p: "[Who it is for, what it covers, any prerequisites.]" },
      { h: "Course three", p: "[Who it is for, what it covers, any prerequisites.]" },
    ],
    listings: [
      { h: "Property one", p: "[Type, location, key features - fill in real details.]" },
      { h: "Property two", p: "[Type, location, key features - fill in real details.]" },
      { h: "Property three", p: "[Type, location, key features - fill in real details.]" },
    ],
    projects: [
      { h: "Project one", p: "[Brief description and what was delivered.]" },
      { h: "Project two", p: "[Brief description and what was delivered.]" },
      { h: "Project three", p: "[Brief description and what was delivered.]" },
    ],
    destinations: [
      { h: "Destination one", p: "[Location, highlights, and how to get there.]" },
      { h: "Destination two", p: "[Location, highlights, and how to get there.]" },
      { h: "Destination three", p: "[Location, highlights, and how to get there.]" },
    ],
    classes: [
      { h: "Class one", p: "[Level, duration, and what to expect.]" },
      { h: "Class two", p: "[Level, duration, and what to expect.]" },
      { h: "Class three", p: "[Level, duration, and what to expect.]" },
    ],
    features: [
      { h: "Feature one", p: "[The problem it solves and who it is for.]" },
      { h: "Feature two", p: "[The problem it solves and who it is for.]" },
      { h: "Feature three", p: "[The problem it solves and who it is for.]" },
    ],
    articles: [
      { h: "Article one", p: "[Headline] - [one-line summary. Add the full post.]" },
      { h: "Article two", p: "[Headline] - [one-line summary. Add the full post.]" },
      { h: "Article three", p: "[Headline] - [one-line summary. Add the full post.]" },
    ],
  };
  return sets[kind] || generic;
}

// ---- the type catalogue ----------------------------------------------------
//
// Ordered most-specific first; the first test that matches wins. Anything that
// matches nothing at all falls through to the generic business site.

const TYPES = [
  {
    key: "cafe",
    test: /restaurant|cafe|café|bistro|bakery|diner|coffee|pizzeria|food truck|bar and grill|canteen/i,
    label: "Restaurant & Cafe",
    defaultName: "Your Restaurant",
    accent: "#f97316",
  },
  {
    key: "clinic",
    test: /clinic|dental|dentist|doctor|medical|hospital|physio|therapist|wellness centre|spa/i,
    label: "Clinic",
    defaultName: "Your Clinic",
    accent: "#14b8a6",
  },
  {
    key: "education",
    test: /school|academy|tutor|college|university|course|training|workshop|e-?learning|learn/i,
    label: "Academy",
    defaultName: "Your Academy",
    accent: "#3b82f6",
  },
  {
    key: "realestate",
    test: /real ?estate|property|apartment|housing|realtor|estate agent|broker/i,
    label: "Real Estate",
    defaultName: "Your Property Agency",
    accent: "#10b981",
  },
  {
    key: "construction",
    test: /construction|contractor|plumbing|plumber|electrician|carpentr|roofing|renovation|home improvement|handyman|painter/i,
    label: "Construction",
    defaultName: "Your Company",
    accent: "#f59e0b",
  },
  {
    key: "travel",
    test: /travel|tour|tourism|vacation|holiday|destination|excursion|itinerary|safari/i,
    label: "Travel",
    defaultName: "Your Travel Co.",
    accent: "#0ea5e9",
  },
  {
    key: "shop",
    test: /shop|store|e-?commerce|clothing|fashion|boutique|retail|products|catalog|catalogue/i,
    label: "Store",
    defaultName: "Your Store",
    accent: "#d946ef",
  },
  {
    key: "photography",
    test: /photograph|photographer|camera|wedding photo/i,
    label: "Photography",
    defaultName: "Your Studio",
    accent: "#a5b4fc",
  },
  {
    key: "music",
    test: /music|musician|band|producer|recording/i,
    label: "Music",
    defaultName: "Your Studio",
    accent: "#8b5cf6",
  },
  {
    key: "fitness",
    test: /gym|fitness|personal trainer|workout|yoga|crossfit/i,
    label: "Fitness",
    defaultName: "Your Gym",
    accent: "#22c55e",
  },
  {
    key: "salon",
    test: /salon|barber|beauty|makeup|nail/i,
    label: "Salon",
    defaultName: "Your Salon",
    accent: "#f43f5e",
  },
  {
    key: "event",
    test: /wedding|event|conference|party|festival|ceremony|birthday/i,
    label: "Event",
    defaultName: "Your Event",
    accent: "#eab308",
  },
  {
    key: "blog",
    test: /blog|blogger|news|magazine|publication|journalism|writer/i,
    label: "Blog",
    defaultName: "Your Magazine",
    accent: "#6366f1",
  },
  {
    key: "portfolio",
    test: /portfolio|freelancer|designer|creative|illustrator|cv|resume|developer/i,
    label: "Portfolio",
    defaultName: "Your Portfolio",
    accent: "#06b6d4",
  },
  {
    key: "agency",
    test: /agency|marketing|digital studio/i,
    label: "Agency",
    defaultName: "Your Agency",
    accent: "#4f46e5",
  },
  {
    key: "product",
    test: /product|app|launch|saas|software|startup|start ?up/i,
    label: "Product",
    defaultName: "Your Product",
    accent: "#6366f1",
  },
  {
    key: "business",
    test: /business|company|corporate|consult|professional|firm|ngo|non-?profit|church|ministry|lawyer|legal|accountant|insurance|contractor|service/i,
    label: "Business",
    defaultName: "Your Business",
    accent: "#4f46e5",
  },
];

const BUILTIN_PAGES = {
  generic: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "services", file: "services.html", label: "Services" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  cafe: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "menu", file: "menu.html", label: "Menu" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  shop: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "products", file: "products.html", label: "Products" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  portfolio: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "work", file: "work.html", label: "Work" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  product: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "features", file: "features.html", label: "Features" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  education: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "courses", file: "courses.html", label: "Courses" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  clinic: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "treatments", file: "treatments.html", label: "Treatments" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Booking" },
  ],
  realestate: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "listings", file: "listings.html", label: "Listings" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  construction: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "projects", file: "projects.html", label: "Projects" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Request a quote" },
  ],
  travel: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "destinations", file: "destinations.html", label: "Destinations" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  photography: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "gallery", file: "gallery.html", label: "Gallery" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  music: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "music", file: "music.html", label: "Music" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  fitness: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "classes", file: "classes.html", label: "Classes" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  salon: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "services", file: "services.html", label: "Services" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Book" },
  ],
  event: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "schedule", file: "schedule.html", label: "Schedule" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "RSVP" },
  ],
  blog: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "articles", file: "articles.html", label: "Articles" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
  agency: [
    { kind: "home", file: "index.html", label: "Home" },
    { kind: "services", file: "services.html", label: "Services" },
    { kind: "about", file: "about.html", label: "About" },
    { kind: "contact", file: "contact.html", label: "Contact" },
  ],
};

function heroTitle(template, name) {
  return template.replace(/\$\{name\}/g, escapeHtml(name));
}

// Hero copy (kicker, lede, optional title/cta) per site type. ${name} is
// replaced with the business name extracted from the brief.
const HEROES = {
  cafe: {
    kicker: "Welcome to",
    lede: "[Say what ${name} does in one or two warm sentences - the food, the feel, the location.]",
    cta: "See the menu",
    ctaFile: "menu.html",
  },
  clinic: {
    kicker: "Care you can trust",
    lede: "[Describe the care ${name} provides and who it is for, in one or two plain sentences.]",
    cta: "Book an appointment",
    ctaFile: "contact.html",
  },
  education: {
    kicker: "Learn with",
    lede: "[Say what ${name} teaches, who it is for, and the outcome students leave with.]",
    cta: "Browse courses",
    ctaFile: "courses.html",
  },
  realestate: {
    kicker: "Find the right place",
    lede: "[Describe the properties and areas ${name} works with in one or two sentences.]",
    cta: "View listings",
    ctaFile: "listings.html",
  },
  construction: {
    kicker: "Built to last",
    lede: "[Say what projects ${name} takes on and the standard of work to expect.]",
    cta: "See our projects",
    ctaFile: "projects.html",
  },
  travel: {
    kicker: "Escape somewhere new",
    lede: "[Describe the trips and destinations ${name} offers in one or two sentences.]",
    cta: "Explore destinations",
    ctaFile: "destinations.html",
  },
  shop: {
    kicker: "The best of",
    lede: "[Describe what ${name} sells and who it is made for.]",
    cta: "Shop products",
    ctaFile: "products.html",
  },
  photography: {
    kicker: "Moments, kept",
    lede: "[Describe the kind of work ${name} photographs - people, places, events.]",
    cta: "View the work",
    ctaFile: "gallery.html",
  },
  music: {
    kicker: "Listen to",
    lede: "[Describe the sound of ${name} and where people can hear it live.]",
    cta: "Check the music",
    ctaFile: "music.html",
  },
  fitness: {
    kicker: "Move more, feel better",
    lede: "[Describe the training ${name} offers, the level it suits, and the goal it moves people toward.]",
    cta: "See the classes",
    ctaFile: "classes.html",
  },
  salon: {
    kicker: "Look and feel great",
    lede: "[Describe the services ${name} offers - hair, skin, nails, and who they suit.]",
    cta: "Book a slot",
    ctaFile: "contact.html",
  },
  event: {
    kicker: "You are invited",
    lede: "[Describe the occasion ${name} celebrates, when it happens and who it is for.]",
    cta: "Check the schedule",
    ctaFile: "schedule.html",
  },
  blog: {
    kicker: "Stories worth reading",
    lede: "[Describe the topics ${name} covers and who reads it.]",
    cta: "Read the latest",
    ctaFile: "articles.html",
  },
  portfolio: {
    kicker: "",
    lede: "Hi, I'm the person behind ${name}. [Add who you are, what you make, and who you've worked with.]",
    cta: "See my work",
    ctaFile: "work.html",
  },
  agency: {
    kicker: "Results, designed",
    lede: "[Describe what ${name} does for clients - the work, the process, the outcome.]",
    cta: "See our services",
    ctaFile: "services.html",
  },
  product: {
    kicker: "Built for people who need to get things done",
    lede: "[Describe ${name} in one sentence: the problem it solves and who it is for.]",
    cta: "See the features",
    ctaFile: "features.html",
  },
  business: {
    kicker: "Welcome to",
    lede: "[Explain what ${name} does in one or two plain sentences - the work, the customers, the area.]",
    cta: "Get in touch",
    ctaFile: "contact.html",
  },
};

const DEFAULT_HERO = {
  kicker: "Welcome to",
  lede: "[Explain what ${name} does in one or two plain sentences.]",
  cta: "Get in touch",
  ctaFile: "contact.html",
};

function makeType(brief) {
  const lower = String(brief || "").toLowerCase();
  let type = TYPES.find((t) => t.test.test(lower)) || TYPES[TYPES.length - 1];
  const name = extractName(brief) || type.defaultName;
  const pages = BUILTIN_PAGES[type.key] || BUILTIN_PAGES.generic;
  return { type, name, pages };
}

// Shared openers for simple content pages.
function contentPage(cfg, { kicker, title, lede, items, mainKind }) {
  return section({ kind: mainKind || "card", kicker, title, lede, items });
}

function homeMain(cfg) {
  const { key: typeKey, label, name } = cfg;
  const h = HEROES[typeKey] || DEFAULT_HERO;
  const safeName = escapeHtml(name);
  const hero = {
    kicker: h.kicker,
    title: h.title ? heroTitle(h.title, name) : safeName,
    lede: heroTitle(h.lede, name),
    cta: h.cta,
    ctaFile: h.ctaFile,
  };
  const cards = [
    { h: label, p: `[Describe the main thing ${safeName} offers.]` },
    { h: "What customers get", p: "[Describe the outcome customers can expect.]" },
    { h: "Get started", p: `[Say how someone begins working with ${safeName}.]` },
  ];
  return (
    heroBlock(hero) +
    `\n  ` +
    section({
      kind: "card",
      heading: "h2",
      kicker: "What we offer",
      title: "What we offer",
      lede: "",
      items: cards,
    })
  );
}

function aboutMain(cfg) {
  return section({
    kind: "card",
    kicker: "About",
    title: "About " + escapeHtml(cfg.name),
    lede: `[Write ${escapeHtml(cfg.name)}'s story, mission and values here - who you serve and why you do what you do.]`,
    items: [
      { h: "Our story", p: "[How it started.]" },
      { h: "What we do", p: "[The work and who it is for.]" },
      { h: "Values", p: "[What working with " + escapeHtml(cfg.name) + " is like.]" },
    ],
  });
}

function contactMain(cfg) {
  return `<section class="section container form-wrap">
    <span class="eyebrow">Contact</span>
    <h1>Contact ${escapeHtml(cfg.name)}</h1>
    <p class="lede">[Add a real address, phone number and hours here. The form below needs a form handler or email service attached.]</p>
    <form>
      <label for="name">Name</label>
      <input id="name" name="name" type="text" autocomplete="name" placeholder="Your name">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com">
      <label for="message">Message</label>
      <textarea id="message" name="message" rows="5" placeholder="How can we help?"></textarea>
      <button class="btn" type="button">Send</button>
    </form>
  </section>`;
}

function extraMain(cfg, page) {
  if (page.kind === "home") return null;
  if (page.kind === "about") return aboutMain(cfg);
  if (page.kind === "contact") return contactMain(cfg);

  const items = defaultCardCopy(page.kind, cfg.name);
  if (page.kind === "schedule") {
    return section({
      kind: "timeline",
      kicker: "Schedule",
      title: "Schedule",
      lede: `[Fill in the running order for ${escapeHtml(cfg.name)}.]`,
      items: items.map((i) => ({ h: "[Time - " + i.h + "]", p: i.p })),
    });
  }
  if (page.kind === "gallery") {
    return section({
      kind: "gallery",
      kicker: "Gallery",
      title: "Gallery",
      lede: `[Swap these placeholders for real photos from ${escapeHtml(cfg.name)}.]`,
      items: [1, 2, 3, 4, 5, 6],
    });
  }
  if (page.kind === "music") {
    return section({
      kind: "list",
      kicker: "Music",
      title: "Music",
      lede: `[Link your tracks, albums and streaming pages for ${escapeHtml(cfg.name)}.]`,
      items: ["Track one - [title and year]", "Track two - [title and year]", "Live shows - [where to see " + escapeHtml(cfg.name) + "]"],
    });
  }
  const titles = {
    menu: "Menu",
    products: "Products",
    work: "Selected work",
    features: "Features",
    courses: "Courses",
    treatments: "Treatments",
    listings: "Listings",
    projects: "Projects",
    destinations: "Destinations",
    classes: "Classes",
    articles: "Articles",
    services: "Services",
  };
  return section({
    kind: "card",
    kicker: titles[page.kind] || page.label,
    title: titles[page.kind] || page.label,
    lede: `[Replace each card with the real details for ${escapeHtml(cfg.name)}.]`,
    items,
  });
}

// ---- styling ---------------------------------------------------------------

function genCss(accent) {
  return `:root{--bg:#0b1020;--surface:#111a33;--card:rgba(255,255,255,.04);--border:rgba(255,255,255,.08);--accent:${accent};--text:#e6e9f2;--muted:#9aa4bd;--white:#ffffff}*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,Cantarell,"Noto Sans",sans-serif;background:var(--bg);color:var(--text);line-height:1.6}a{color:inherit;text-decoration:none}img{max-width:100%;display:block}.container{width:min(1100px,90%);margin:0 auto}.header{background:rgba(11,16,32,.92);position:sticky;top:0;z-index:10;border-bottom:1px solid var(--border);backdrop-filter:blur(6px)}.header-inner{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 0}.logo{font-weight:800;font-size:1.15rem;letter-spacing:.02em}.nav{display:flex;gap:1.1rem;flex-wrap:wrap}.nav a{color:var(--muted);font-size:.95rem;padding:.35rem .1rem;transition:color .15s ease}.nav a:hover,.nav a[aria-current="page"]{color:var(--accent)}.hero{padding:4.5rem 0 3.5rem;background:radial-gradient(ellipse at 20% -10%,${accent}33,transparent 55%),linear-gradient(180deg,var(--surface),var(--bg))}.hero h1{font-size:clamp(2rem,6vw,3.6rem);line-height:1.1;margin-bottom:1rem}.lede{color:var(--muted);font-size:1.08rem;max-width:62ch;margin:0 0 1.75rem}.eyebrow{display:inline-block;text-transform:uppercase;letter-spacing:.16em;font-size:.8rem;font-weight:700;color:var(--accent);margin-bottom:.75rem}.btn{display:inline-block;background:var(--accent);color:var(--white);padding:.8rem 1.6rem;border-radius:.55rem;font-weight:600;transition:filter .15s ease}.btn:hover{filter:brightness(1.1)}.section{padding:3rem 0}.section h1{font-size:clamp(1.6rem,4vw,2.4rem);margin-bottom:.6rem}.section-title{font-size:1.4rem;margin-bottom:.6rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.25rem;margin-top:1.5rem}.card{background:var(--card);border:1px solid var(--border);border-radius:.8rem;padding:1.4rem}.card h3{color:var(--accent);margin-bottom:.45rem;font-size:1.05rem}.card p,.hero .lede{color:var(--muted)}.plain-list{list-style:none;display:grid;gap:.75rem;margin-top:1.5rem}.plain-list li{background:var(--card);border:1px solid var(--border);border-radius:.6rem;padding:1rem;color:var(--muted)}.timeline{list-style:none;margin-top:1.5rem;border-left:2px solid var(--border);padding-left:1.25rem;display:grid;gap:1.25rem}.timeline li strong{color:var(--text);display:block}.timeline li{color:var(--muted)}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1.25rem;margin-top:1.5rem}.ph{aspect-ratio:4/3;background:var(--card);border:1px dashed var(--border);border-radius:.7rem;display:grid;place-items:center;color:var(--muted);font-size:.85rem;text-align:center;padding:.5rem}.form-wrap form{display:grid;gap:.5rem;max-width:480px;margin-top:1.25rem}.form-wrap label{font-size:.9rem;font-weight:600;color:var(--muted)}.form-wrap input,.form-wrap textarea{background:var(--card);border:1px solid var(--border);border-radius:.5rem;color:var(--text);padding:.7rem .85rem;font:inherit;width:100%}.form-wrap .btn{margin-top:.5rem;border:none;cursor:pointer}.footer{border-top:1px solid var(--border);padding:1.75rem 0;color:var(--muted);text-align:center;font-size:.9rem}a:focus-visible,input:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media(max-width:640px){.hero{padding:3rem 0}.header-inner{align-items:flex-start}.nav{order:2;width:100%;gap:.75rem}`;
}

function genJs() {
  return `// Generated by MITEX AI (stub mode).
// Attach your own behaviour here - this file exists so the site has
// somewhere to grow without touching the markup.
console.log("MITEX AI site loaded (stub mode)");`;
}

// ---- the build -------------------------------------------------------------

async function generateSiteStub({ brief = "", kind = "build", extraNotes = "" } = {}) {
  const validateBundle = validator();
  const { type, name, pages } = makeType(brief);
  const year = new Date().getFullYear();
  const tagline = `${name} - ${type.label} site built from your brief`;

  const files = [];
  for (const page of pages) {
    const main = page.kind === "home" ? homeMain({ ...type, name }) : extraMain({ ...type, name }, page);
    const description =
      page.kind === "home"
        ? tagline
        : `${page.label} - ${name} - ${type.label.toLowerCase()}`;
    files.push({
      path: page.file,
      content: pageShell({
        pages,
        name,
        active: page.label,
        title:
          page.kind === "home"
            ? `${name} - ${type.label}`
            : `${page.label} - ${name}`,
        description,
        year,
        main,
      }),
    });
  }

  files.push({
    path: "styles.css",
    content: genCss(type.accent),
  });
  files.push({
    path: "app.js",
    content: genJs(),
  });
  files.push({
    path: "README.md",
    content: `# ${name}\n\nA ${type.label.toLowerCase()} site generated by MITEX AI (stub mode).\n\n## Brief\n\n${String(brief).slice(0, 2000)}\n\n## Included files\n\n${pages
      .map((p) => `- ${p.file}`)
      .join("\n")}\n- styles.css\n- app.js\n\n## Before going live\n\nReplace every [placeholder] with real copy, add a logo and photos, ` +
      `wire the contact form to a handler, and publish to any static host.`,
  });

  const checked = validateBundle(files);
  if (!checked.ok) {
    const err = new Error(`Stub bundle failed validation: ${checked.errors.join("; ")}`);
    err.code = "VALIDATION_FAILED";
    throw err;
  }

  const notes =
    "Generated by the offline fallback while AI credits are at zero. Real copy, logo, photos, contact details and a working form handler still need to be supplied." +
    (extraNotes ? `\n\nExtra notes from the brief: ${String(extraNotes).trim()}` : "");

  return {
    ok: true,
    files: checked.files,
    errors: [],
    warnings: checked.warnings,
    summary:
      kind === "fix"
        ? `Rebuilt the ${type.label.toLowerCase()} site for ${name} from your brief (stub mode)`
        : `Built a ${type.label.toLowerCase()} site for ${name} (stub mode)`,
    notes,
    usage: { inputTokens: 0, outputTokens: 0 },
    model: "stub/mitex-ai",
  };
}

module.exports = { generateSiteStub, makeId };