/**
 * Pins backfill-listing-categories.js to the real catalogue.
 *
 * The classifier is ordered keyword matching, so it has two failure modes that
 * no amount of dry-run output reveals: a word that is too generic files a
 * listing under the wrong category, and a fix for that word re-files a listing
 * that was right. Every case below is a real listing title/description that
 * ships in the seed data, so this test fails loudly if a rule is loosened into
 * one of those mistakes again.
 */
const { classify } = require("./backfill-listing-categories");

const CASES = [
  // --- real catalogue rows that must land in the right bucket -------------
  ["LuxePort - Portfolio Showcase", "Stunning animated portfolio site with responsive design, smooth scroll effects and a working contact form. Perfect for creatives and agencies.", "portfolio"],
  ["MusicWave - Artist Promo Site", "Vibrant artist or DJ site with music player, video embeds, tour dates, merch store and fan mailing list growth tools.", "portfolio"],

  // The regression that motivated this test. "sponsor showcase" is not evidence
  // of a portfolio site; it used to be treated as one. Event ticketing is a
  // platform product, so `saas` is the honest answer.
  ["EventPro - Tickets & Events", "Event platform with ticket tiers, QR-code check-in, attendee dashboard, sponsor showcase and countdown landing pages.", "saas"],

  ["ShopLite - One-Page Mini Store", "Single page product showcase with cart, checkout and Paystack payments.", "ecommerce"],
  ["NovaMart - E-Commerce Starter", "Full storefront with product catalog, shopping cart and inventory.", "ecommerce"],
  ["BuildTrack - Construction Company", "Corporate site for a construction company with project portfolio and quote requests.", "corporate"],
  ["LegalEdge - Law Firm Website", "Law firm website with practice areas and consultation booking.", "corporate"],
  ["LearnSpark - Online Courses", "Online courses with curriculum, quizzes and student enrolment.", "education"],
  ["SchoolHub - School Management System", "School management with student records and attendance.", "education"],
  ["HomeFind - Real Estate Listings", "Real estate listings with property details and realtor contact.", "real-estate"],
  ["MedBook - Clinic Appointments", "Clinic website with patient appointments and doctor profiles.", "healthcare"],
  ["FoodDash - Restaurant & Delivery", "Restaurant menu with order-ahead and food delivery.", "restaurant"],
  ["SwiftPay - Fintech Landing Page", "Fintech landing page for a payments and wallet product.", "finance"],
  ["CryptoView - Fintech Dashboard", "Crypto trading dashboard with live charts.", "finance"],
  ["NewsSphere - Magazine & Blog", "Magazine and blog with editorial categories and newsletter signup.", "blog"],
  ["JobBoard Pro - Recruitment Portal", "Job board with job posting and applicant tracking.", "saas"],
  ["BeautyLane - Salon & Spa", "Salon website with bookings for beauty services.", "services"],
  ["TravelNest - Tour Agency", "Tour agency site with tour packages and booking enquiries.", "services"],
  ["FitPulse - Gym & Fitness Site", "Gym and fitness studio with class timetable and bookings.", "services"],
  ["AutoDeal - Car Dealership Platform", "Car dealership with vehicle inventory and test-drive requests.", "services"],

  // --- rows with no defensible signal must stay unclassified -------------
  ["AgroMart", "Marketplace platform.", null],
  ["FaithConnect", "Community platform.", null],
  ["Upgrade Biz", "A business upgrade page.", null],

  // --- smoke-test fixtures must never be classified ----------------------
  // Classifying these puts "NotReady Store" into a customer-facing filter.
  ["PayTest Store", "store", null],
  ["NotReady Store 1791036553", "store", null],
  ["ZZ Delivery Leak Probe", "temporary", null],
];

let pass = 0;
let fail = 0;

for (const [title, description, expected] of CASES) {
  const got = classify({ title, description });
  if (got === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  "${title}"`);
    console.log(`        expected ${expected === null ? "unclassified" : expected}, got ${got === null ? "unclassified" : got}`);
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);