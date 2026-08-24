const APP_URL = process.env.APP_URL || "http://localhost:3000";

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

function libraryLoaded() {
  try {
    require("nodemailer");
    return true;
  } catch {
    return false;
  }
}

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

function naira(amount) {
  return "\u20A6" + Number(amount || 0).toLocaleString("en-NG");
}

function receiptEmail(order) {
  return {
    subject: `MITEX receipt - ${order.title} (${order.reference})`,
    text: `Thank you for your purchase!\n\nOrder:   ${order.title}\nAmount:  ${naira(order.amount)}\nRef:     ${order.reference}\nDate:    ${order.paid_at || new Date().toISOString()}\n\nYour website download is available in My Account on MITEX.\nQuestions? WhatsApp +234 701 163 3770.\n\n- MITEX team`,
  };
}

function salaryEmail(staff, payment) {
  return {
    subject: `MITEX salary paid - ${payment.period}`,
    text: `Hi ${staff.name},\n\nYour salary has been recorded as paid:\n\nPeriod: ${payment.period}\nAmount: ${naira(payment.amount)}${payment.bonus ? `\nBonus:  ${naira(payment.bonus)}` : ""}${payment.note ? `\nNote:   ${payment.note}` : ""}\n\nKeep this email as your record. Questions? Talk to admin.\n\n- MITEX team`,
  };
}

module.exports = { sendMail, verificationEmail, resetEmail, testEmail, hireEmail, receiptEmail, salaryEmail, smtpConfigured, libraryLoaded, APP_URL };
