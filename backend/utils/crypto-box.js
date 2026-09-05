const crypto = require("crypto");

if (process.env.NODE_ENV === "production" && (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32)) {
  console.error("FATAL: JWT_ACCESS_SECRET required for PII encryption at rest in production");
  process.exit(1);
}
// AES-256-GCM box for sensitive data at rest (applicant payment details).
// Key is derived from JWT_ACCESS_SECRET so no extra secret to manage.
const KEY = crypto.scryptSync(process.env.JWT_ACCESS_SECRET || "mitex-dev-secret", "mitex-pay-vault-v1", 32);

function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function decrypt(payload) {
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt };
