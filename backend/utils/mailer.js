const APP_URL = process.env.APP_URL || "http://localhost:3000";

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

async function sendMail({ to, subject, text }) {
  if (!smtpConfigured()) {
    console.warn(`\n[mailer:dev] SMTP not configured. Email not really sent.`);
    console.warn(`[mailer:dev] To: ${to}`);
    console.warn(`[mailer:dev] Subject: ${subject}`);
    console.warn(`${text}\n`);
    return { dev: true };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    console.warn("[mailer:dev] SMTP configured but nodemailer is not installed (npm install nodemailer). Logging instead.");
    console.warn(`${text}`);
    return { dev: true };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || "MITEX <no-reply@mitex.store>",
    to,
    subject,
    text,
  });

  return { dev: false };
}

function verificationEmail(user, rawToken) {
  const url = `${APP_URL}/api/auth/verify-email?token=${rawToken}`;
  return {
    subject: "Verify your MITEX account",
    text: `Hi ${user.name},\n\nVerify your email address by opening this link:\n${url}\n\nThis link expires in 24 hours.\n\n- MITEX team`,
    url,
  };
}

function resetEmail(user, rawToken) {
  const url = `${APP_URL}/reset-password.html?token=${rawToken}`;
  return {
    subject: "Reset your MITEX password",
    text: `Hi ${user.name},\n\nReset your password by opening this link:\n${url}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.\n\n- MITEX team`,
    url,
  };
}

module.exports = { sendMail, verificationEmail, resetEmail, smtpConfigured, APP_URL };
