const { encrypt, decrypt } = require("./crypto-box");

const MIN_AGE = 18;

// Returns { ok: true, age } or { ok: false, error }
function validateDob(dob) {
  if (typeof dob !== "string" || !dob.trim()) {
    return { ok: false, error: "Date of birth is required" };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
  if (!m) {
    return { ok: false, error: "Date of birth must be a real date in YYYY-MM-DD format" };
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const utcY = dt.getUTCFullYear();
  const utcM = dt.getUTCMonth();
  const utcD = dt.getUTCDate();
  if (utcY !== y || utcM !== mo - 1 || utcD !== d) {
    return { ok: false, error: "That date is not a real calendar date" };
  }
  const today = new Date();
  if (dt > today) {
    return { ok: false, error: "Date of birth cannot be in the future" };
  }
  let age = today.getUTCFullYear() - y;
  const md = today.getUTCMonth() - (mo - 1);
  if (md < 0 || (md === 0 && today.getUTCDate() < d)) age--;
  if (age < MIN_AGE) {
    return { ok: false, error: `You must be at least ${MIN_AGE} years old to use MITEX` };
  }
  return { ok: true, age };
}

// NIN and BVN are both exactly 11 digits.
function validateNin(value) {
  const s = String(value || "").trim();
  if (!s) {
    return { ok: false, error: "NIN/BVN number is required" };
  }
  if (!/^\d{11}$/.test(s)) {
    return { ok: false, error: "NIN/BVN must be the 11-digit number on your ID" };
  }
  return { ok: true };
}

// Optional verification-photo upload - a small image data URL only.
const NIN_FILE_RE = /^data:image\/(png|jpe?g|webp);base64,/;
const NIN_FILE_MAX = 2 * 1024 * 1024;

function validateNinFile(file) {
  if (file === undefined || file === null || file === "") return { ok: true, value: null };
  const s = String(file);
  if (!NIN_FILE_RE.test(s)) {
    return { ok: false, error: "Verification photo must be a PNG or JPEG image" };
  }
  if (Buffer.byteLength(s, "utf8") > NIN_FILE_MAX) {
    return { ok: false, error: "Verification photo is too large (max 2MB)" };
  }
  return { ok: true, value: s };
}

// NIN/BVN and the uploaded photo are sensitive PII - stored encrypted at rest.
const encNin = (value) => (value === null || value === undefined || value === "" ? null : encrypt(String(value)));
const decNin = (value) => (value ? decrypt(String(value)) : null);

module.exports = { MIN_AGE, validateDob, validateNin, validateNinFile, encNin, decNin, NIN_FILE_RE, NIN_FILE_MAX };