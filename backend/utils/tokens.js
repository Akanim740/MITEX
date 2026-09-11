const crypto = require("crypto");

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

module.exports = { randomToken, randomOtp, sha256 };
