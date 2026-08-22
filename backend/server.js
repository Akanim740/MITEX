require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const path = require("path");

const { getStore } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

let store;
app.use((req, res, next) => {
  req.store = store;
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: "Too many requests, please try again later" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Too many auth attempts, please try again later" },
});

const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many submissions, please try again later" },
});

app.use(generalLimiter);
app.use(cookieParser());
app.use(
  express.json({
    limit: "20kb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname, "..")));

app.use("/api/auth", authLimiter, require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/enquiries", enquiryLimiter, require("./routes/enquiries"));
app.use("/api/listings", require("./routes/listings"));
app.use("/api/newsletter", require("./routes/newsletter"));
app.use("/api/payments", require("./routes/payments"));

app.get("/api/health", async (req, res) => {
  try {
    res.json({
      status: "ok",
      database: store ? store.name : "connecting",
      service: "MITEX API",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: "degraded", error: err.message });
  }
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

getStore()
  .then(async (resolved) => {
    store = resolved;
    if (process.env.SEED_ON_BOOT === "true") {
      try {
        await require("./scripts/seed").runSeed();
      } catch (err) {
        console.error(`  Seed on boot failed: ${err.message}`);
      }
    }
    app.listen(PORT, () => {
      console.log(`\n  MITEX server running at http://localhost:${PORT}`);
      console.log(`  Database driver: ${store.name}`);
      console.log(`  Admin dashboard: http://localhost:${PORT}/dashboard.html\n`);
    });
  })
  .catch((err) => {
    console.error("\n  Failed to connect to database:");
    console.error(`  ${err.message}\n`);
    process.exit(1);
  });
