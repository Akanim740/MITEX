require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const path = require("path");

const { getStore } = require("./db");
const { smtpConfigured } = require("./utils/mailer");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.disable("x-powered-by");

// Boot guard: refuse insecure defaults in production
if (process.env.NODE_ENV === "production" && (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32)) {
  console.error("FATAL: set a strong JWT_ACCESS_SECRET (32+ random chars) in production");
  process.exit(1);
}

// Loud warning: without SMTP_* env vars every email (verifications, password
// resets, receipts) is only logged to the admin Email Outbox, never delivered.
if (process.env.NODE_ENV === "production" && !smtpConfigured()) {
  console.warn("[mailer] WARNING: SMTP is NOT configured (set SMTP_HOST / SMTP_USER / SMTP_PASS in Render -> Environment).");
  console.warn("[mailer] Emails are being captured in the admin Email Outbox but are NOT being delivered.");
}

let store;
app.use((req, res, next) => {
  req.store = store;
  next();
});

// Block public access to source code and internal files.
// IMPORTANT: test the DECODED path (req.path stays percent-encoded), otherwise
// tokens like %2e and %65 can be used to smuggle ".db"/"backend" past the
// filter while serve-static happily decodes them. Try/catch guards malformed
// escapes (e.g. a trailing "%" which throws URIError on decode).
const BLOCKED_PATH = /^\/(\.git|\.env|backend|node_modules|scripts|deliveries)(\/|$)|\.(sql|db|md|log|ps1|lock|jar|war)$|^\/package(-lock)?\.json$|^\/render\.ya?ml$/i;
app.use((req, res, next) => {
  try {
    // decodeURIComponent turns %2e/%2f/%5c back into their literal chars.
    // Loop (bounded) so double-encoded "%255c" attacks collapse too, then
    // normalize backslashes to slashes: on Windows "\" is also a path
    // separator, so raw backslashes could otherwise bypass the blocklist.
    let decoded = req.path;
    for (let i = 0; i < 3; i++) {
      if (!decoded.includes("%")) break;
      let d;
      try {
        d = decodeURIComponent(decoded);
      } catch {
        break;
      }
      if (d === decoded) break;
      decoded = d;
    }
    // Normalize backslashes to slashes (Windows path separator), then collapse
    // repeated slashes: "%5cbackend" decodes to "\backend", which after the
    // backslash swap becomes "//backend" and would otherwise skip the blocklist.
    decoded = decoded.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    if (BLOCKED_PATH.test(decoded)) return res.status(404).json({ error: "Not found" });
  } catch {}
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://www.google-analytics.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 15552000, includeSubDomains: true },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

// Same-origin site needs no cross-origin API access; lock CORS unless explicitly opened
const corsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : false,
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

// Redact secrets/tokens before persisting any response body to the audit log
// (access tokens, refresh tokens and dev-only one-time codes are never stored).
const AUDIT_REDACT = new Set(["accessToken", "refreshToken", "devToken", "devOtp"]);
function redactAuditBody(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const out = { ...body };
  for (const key of AUDIT_REDACT) {
    if (key in out) out[key] = "redacted";
  }
  return out;
}

// Audit trail: log API mutations (actions + response summary, never request bodies)
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const action = `${req.method} ${req.path}`.slice(0, 64);
  const original = res.json.bind(res);
  res.json = (body) => {
    original(body);
    setImmediate(async () => {
      try {
        const safeBody = redactAuditBody(body);
        await store.audit.log({
          userId: req.user ? req.user.id : null,
          email: req.user ? req.user.email : null,
          action,
          detail: typeof safeBody === "string" ? safeBody.slice(0, 200) : JSON.stringify(safeBody).slice(0, 200),
          ip: req.ip,
        });
      } catch {}
    });
  };
  next();
});

app.use(express.static(path.join(__dirname, "..")));

app.use("/api/auth", authLimiter, require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/enquiries", enquiryLimiter, require("./routes/enquiries"));
app.use("/api/listings", require("./routes/listings"));
app.use("/api/newsletter", require("./routes/newsletter"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/packages", require("./routes/packages"));
app.use("/api/applications", require("./routes/applications"));
app.use("/api/analyze", require("./routes/analyze"));
app.use("/api/salaries", require("./routes/salaries"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/push", require("./routes/push"));
app.use("/api/admin", require("./routes/admin"));

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

app.get("/api/audit", require("./middleware/auth").requireAuth, require("./middleware/auth").requireRole("admin"), async (req, res) => {
  try {
    res.json(await store.audit.list(Number(req.query.limit) || 100));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  const fourOhFour = path.join(__dirname, "..", "404.html");
  res.status(404).sendFile(fourOhFour);
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
    require("./routes/applications").startAutomation(store);

    setInterval(async () => {
      try {
        // Expire stale pending checkout orders (30 min no-pay → failed).
        const stale = await store.orders.listAll("pending");
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const order of stale) {
          const created = new Date(order.created_at).getTime();
          if (created < cutoff) {
            await store.orders.markFailed(order.reference);
          }
        }

        // Release "waiting" buy-intents older than 4 days: a buyer that never
        // follows through must not block later buyers or get a surprise
        // "ready" notification when delivery eventually lands.
        if (store.buyIntents && store.buyIntents.expireStale) {
          await store.buyIntents.expireStale(4 * 24 * 60 * 60 * 1000);
        }
      } catch {}
    }, 15 * 60 * 1000);

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
