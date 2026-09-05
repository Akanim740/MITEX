require("dotenv").config();
const bcrypt = require("bcryptjs");
const { getStore } = require("../db");

async function runSeed() {
  console.log("Seeding MITEX database...");
  const store = await getStore();

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@mitex.store").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: ADMIN_PASSWORD must be set in production for the seed admin");
      process.exit(1);
    }
  }
  const adminName = process.env.ADMIN_NAME || "MITEX Admin";

  const existing = await store.users.findByEmail(adminEmail);
  if (!existing) {
    const hash = await bcrypt.hash(adminPassword || "ChangeMe123!", 12);
    await store.users.create({
      name: adminName,
      email: adminEmail,
      passwordHash: hash,
      role: "admin",
      emailVerified: 1,
    });
    console.log(`  Admin created: ${adminEmail} (role: admin, verified)`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`  Default password used: ChangeMe123! (set ADMIN_PASSWORD in .env to change)`);
    }
  } else {
    console.log(`  Admin already exists: ${adminEmail}`);
  }

  const CATALOG = [
    { title: "NovaMart - E-Commerce Starter", description: "Complete online store with product catalog, cart, secure checkout and an admin dashboard for orders and inventory. Level 5 build, ready to rebrand and launch.", price: 450000, level: 5, tech_stack: "HTML/CSS/JS, Node.js, SQLite, Payments" },
    { title: "LuxePort - Portfolio Showcase", description: "Stunning animated portfolio site with responsive design, smooth scroll effects and a working contact form. Perfect for creatives and agencies.", price: 120000, level: 2, tech_stack: "HTML/CSS/JS" },
    { title: "BookNest - Booking Platform", description: "Appointment booking platform with user accounts, database-backed schedules, email notifications and SEO optimization baked in.", price: 680000, level: 6, tech_stack: "Node.js, SQLite, JWT Auth" },
    { title: "SchoolHub - School Management System", description: "Full school portal with student records, result checking, fee payments, attendance tracking and a parent communication module.", price: 750000, level: 6, tech_stack: "Node.js, SQLite, Payments, JWT Auth" },
    { title: "FoodDash - Restaurant & Delivery", description: "Mouth-watering restaurant site with digital menu, table reservations, order-ahead functionality and WhatsApp ordering integration.", price: 520000, level: 5, tech_stack: "HTML/CSS/JS, Node.js, SQLite" },
    { title: "SereneStay - Hotel Booking Website", description: "Elegant hotel site with room gallery, live availability calendar, instant booking with Paystack deposit and guest reviews.", price: 600000, level: 5, tech_stack: "Node.js, SQLite, Payments" },
    { title: "AutoDeal - Car Dealership Platform", description: "Sleek dealership site with vehicle inventory, photo galleries, price filters, test-drive booking and seller contact forms.", price: 580000, level: 5, tech_stack: "HTML/CSS/JS, Node.js, SQLite" },
    { title: "HomeFind - Real Estate Listings", description: "Property marketplace with map search, listing filters, agent profiles, image galleries and enquiry tracking for each property.", price: 490000, level: 4, tech_stack: "Node.js, SQLite" },
    { title: "FaithConnect - Church Management", description: "Church website with sermon archive, event calendar, member portal, online tithes and offerings via Paystack and SMS announcements.", price: 420000, level: 4, tech_stack: "Node.js, SQLite, Payments" },
    { title: "MedBook - Clinic Appointments", description: "Clinic system with doctor profiles, appointment scheduling, patient records, automated reminders and billing summaries.", price: 700000, level: 6, tech_stack: "Node.js, SQLite, JWT Auth" },
    { title: "FitPulse - Gym & Fitness Site", description: "High-energy gym website with class timetables, trainer profiles, membership signup with recurring plans before/after galleries.", price: 260000, level: 3, tech_stack: "HTML/CSS/JS" },
    { title: "EventPro - Tickets & Events", description: "Event platform with ticket tiers, QR-code check-in, attendee dashboard, sponsor showcase and countdown landing pages.", price: 380000, level: 4, tech_stack: "Node.js, SQLite, Payments" },
    { title: "NewsSphere - Magazine & Blog", description: "Publishing platform with categories, editor dashboard, comments, newsletter integration and lightning-fast SEO-friendly pages.", price: 320000, level: 3, tech_stack: "Node.js, SQLite" },
    { title: "ShopLite - One-Page Mini Store", description: "Lightweight single-page store perfect for small businesses: product grid, WhatsApp checkout, testimonials and Instagram feed.", price: 150000, level: 2, tech_stack: "HTML/CSS/JS" },
    { title: "LegalEdge - Law Firm Website", description: "Authoritative law firm site with practice areas, attorney bios, case enquiry intake form and confidential consultation booking.", price: 220000, level: 3, tech_stack: "HTML/CSS/JS" },
    { title: "AgroMart - Farm Marketplace", description: "Farm-to-table marketplace connecting farmers to buyers with produce listings, bulk orders, delivery zones and farmer payouts.", price: 540000, level: 5, tech_stack: "Node.js, SQLite, Payments" },
    { title: "CryptoView - Fintech Dashboard", description: "Premium fintech dashboard with live charts, portfolio tracking, transaction history, KYC onboarding flow and admin controls.", price: 850000, level: 7, tech_stack: "Node.js, WebSocket, JWT Auth" },
    { title: "LearnSpark - Online Courses", description: "E-learning platform with course builder, video lessons, quizzes, student progress tracking and certificate generation.", price: 800000, level: 6, tech_stack: "Node.js, SQLite, Payments, JWT Auth" },
    { title: "TravelNest - Tour Agency", description: "Travel agency site with tour packages, itinerary pages, photo stories, date pickers and deposit-based online booking.", price: 360000, level: 4, tech_stack: "HTML/CSS/JS, Node.js" },
    { title: "BeautyLane - Salon & Spa", description: "Glamorous salon site with service menu price list, stylist booking, loyalty perks gallery and gift voucher sales.", price: 240000, level: 3, tech_stack: "HTML/CSS/JS" },
    { title: "BuildTrack - Construction Company", description: "Solid construction company site with project portfolio, progress galleries, services breakdown and quote request pipeline.", price: 280000, level: 3, tech_stack: "HTML/CSS/JS" },
    { title: "MusicWave - Artist Promo Site", description: "Vibrant artist or DJ site with music player, video embeds, tour dates, merch store and fan mailing list growth tools.", price: 180000, level: 2, tech_stack: "HTML/CSS/JS" },
    { title: "JobBoard Pro - Recruitment Portal", description: "Recruitment platform with employer dashboards, job posting, applicant tracking, resume search and subscription billing.", price: 720000, level: 6, tech_stack: "Node.js, SQLite, Payments, JWT Auth" },
    { title: "SwiftPay - Fintech Landing Page", description: "Conversion-focused fintech landing page with animated feature sections, waitlist signup, FAQ accordion and blog stub.", price: 95000, level: 1, tech_stack: "HTML/CSS/JS" },
  ];

  const existingListings = await store.listings.list({ includeSold: true });
  const knownTitles = new Set(existingListings.map((l) => l.title));

  let created = 0;
  for (const item of CATALOG) {
    if (knownTitles.has(item.title)) continue;
    await store.listings.create(item);
    created++;
  }
  console.log(`  Catalog: ${created} new listings created (${existingListings.length} already present)`);

  console.log("Done.");
}

async function seed() {
  await runSeed();
}

module.exports = { runSeed };

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err.message);
      process.exit(1);
    });
}
