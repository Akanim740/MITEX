const jwt = require("jsonwebtoken");
const { sha256 } = require("../utils/tokens");

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "mitex-dev-secret-change-me";
const ACCESS_TTL = process.env.ACCESS_TTL || "15m";

function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_ACCESS_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const store = req.store;
  if (!store) {
    return res.status(500).json({ error: "Database not ready" });
  }

  const user = await store.users.findById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: "Account no longer exists" });
  }

  const { password_hash, ...safeUser } = user;
  req.user = safeUser;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

async function resolveRefreshSession(req) {
  const raw = req.cookies ? req.cookies.mitex_refresh : null;
  if (!raw) return null;
  const store = req.store;
  const session = await store.sessions.findValid(sha256(raw));
  if (!session) return null;
  const user = await store.users.findById(session.user_id);
  if (!user) return null;
  return { session, user };
}

module.exports = { signAccessToken, requireAuth, requireRole, resolveRefreshSession, JWT_ACCESS_SECRET, ACCESS_TTL };
