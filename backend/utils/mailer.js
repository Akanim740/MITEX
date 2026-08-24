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

function testEmail(app, rawToken, instructions) {
  const url = `${APP_URL}/careers.html?token=${rawToken}`;
  return {
    subject: "MITEX employment test - your next step",
    text: `Hi ${app.name},\n\nCongratulations! Your application to join the MITEX team has been reviewed and you are moving to the next stage.\n\nYOUR TEST\n${instructions}\n\nWhen your test website is ready, submit it through your private application page:\n${url}\n\nKeep this link safe - it is your personal window into your application status.\n\n- MITEX team`,
    url,
  };
}

function hireEmail(app, rawToken) {
  const url = `${APP_URL}/onboard.html?token=${rawToken}`;
  return {
    subject: "Welcome to the MITEX team, " + app.name + "!",
    text: `Hi ${app.name},\n\nGreat news - you PASSED. We are officially welcoming you to the MITEX team.\n\nSet up your work account password by opening this private link:\n${url}\n\nAfter choosing a password you will go straight to your work dashboard.\nThis link works once, so do it soon.\n\n- MITEX team`,
    url,
  };
}

module.exports = { sendMail, verificationEmail, resetEmail, testEmail, hireEmail, smtpConfigured, APP_URL };
