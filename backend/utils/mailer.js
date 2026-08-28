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

function emailWrap(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e1a;padding:32px 16px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111827;border-radius:12px;border:1px solid #1f2937;overflow:hidden;"><tr><td style="padding:28px 32px;"><a href="${APP_URL}" style="text-decoration:none;font-family:'Sora',sans-serif;font-size:22px;font-weight:800;color:#fbbf24;">MIT<span style="color:#fff;">EX</span></a></td></tr><tr><td style="padding:0 32px 28px;">${body}</td></tr><tr><td style="padding:16px 32px;border-top:1px solid #1f2937;font-size:12px;color:#6b7280;">&copy; ${new Date().getFullYear()} MITEX. All rights reserved.<br/><a href="${APP_URL}/privacy.html" style="color:#fbbf24;">Privacy</a> &middot; <a href="${APP_URL}/terms.html" style="color:#fbbf24;">Terms</a></td></tr></table></td></tr></table></body></html>`;
}

function emailBtn(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#fbbf24;color:#070b14;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;margin-top:12px;">${label}</a>`;
}

async function sendMail({ to, subject, text, html }) {
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
    family: 4,
  });

  const msg = { from: process.env.SMTP_FROM || "MITEX <no-reply@mitex.store>", to, subject, text };
  if (html) msg.html = html;

  await transporter.sendMail(msg);
  return { dev: false };
}

function verificationEmail(user, rawToken) {
  const url = `${APP_URL}/api/auth/verify-email?token=${rawToken}`;
  return {
    subject: "Verify your MITEX account",
    text: `Hi ${user.name},\n\nVerify your email address by opening this link:\n${url}\n\nThis link expires in 24 hours.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${user.name},</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Verify your email address to secure your account and start browsing premium websites.</p>${emailBtn(url, "Verify Email")}<p style="color:#9ca3af;font-size:13px;margin-top:20px;">This link expires in 24 hours.</p>`),
    url,
  };
}

function resetEmail(user, rawToken) {
  const url = `${APP_URL}/reset-password.html?token=${rawToken}`;
  return {
    subject: "Reset your MITEX password",
    text: `Hi ${user.name},\n\nReset your password by opening this link:\n${url}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${user.name},</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">You requested a password reset. Click the button below to set a new password.</p>${emailBtn(url, "Reset Password")}<p style="color:#9ca3af;font-size:13px;margin-top:20px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>`),
    url,
  };
}

function testEmail(app, rawToken, instructions) {
  const url = `${APP_URL}/careers.html?token=${rawToken}`;
  return {
    subject: "MITEX employment test - your next step",
    text: `Hi ${app.name},\n\nCongratulations! Your application to join the MITEX team has been reviewed and you are moving to the next stage.\n\nYOUR TEST\n${instructions}\n\nWhen your test website is ready, submit it through your private application page:\n${url}\n\nKeep this link safe - it is your personal window into your application status.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${app.name},</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Congratulations! Your application has been reviewed and you're moving to the next stage.</p><div style="background:#1f2937;border-radius:8px;padding:16px 20px;margin:16px 0;"><p style="color:#fbbf24;font-weight:700;font-size:13px;margin:0 0 6px;">YOUR TEST</p><p style="color:#d1d5db;font-size:14px;line-height:1.6;margin:0;">${instructions.replace(/\n/g, "<br/>")}</p></div>${emailBtn(url, "Submit Your Test")}<p style="color:#9ca3af;font-size:13px;margin-top:20px;">Keep this link safe — it's your personal application page.</p>`),
    url,
  };
}

function hireEmail(app, rawToken) {
  const url = `${APP_URL}/onboard.html?token=${rawToken}`;
  return {
    subject: "Welcome to the MITEX team, " + app.name + "!",
    text: `Hi ${app.name},\n\nGreat news - you PASSED. We are officially welcoming you to the MITEX team.\n\nSet up your work account password by opening this private link:\n${url}\n\nAfter choosing a password you will go straight to your work dashboard.\nThis link works once, so do it soon.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${app.name},</p><p style="color:#10b981;font-size:16px;font-weight:700;">You're in! Welcome to the MITEX team.</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Set up your work account password to get started.</p>${emailBtn(url, "Set Up Your Account")}<p style="color:#9ca3af;font-size:13px;margin-top:20px;">This link works once. Set up your password soon.</p>`),
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
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Thank you for your purchase!</p><div style="background:#1f2937;border-radius:8px;padding:16px 20px;margin:16px 0;"><table style="width:100%;font-size:14px;color:#d1d5db;"><tr><td style="padding:4px 0;">Order</td><td style="padding:4px 0;text-align:right;color:#fff;">${order.title}</td></tr><tr><td style="padding:4px 0;">Amount</td><td style="padding:4px 0;text-align:right;color:#fbbf24;font-weight:700;">${naira(order.amount)}</td></tr><tr><td style="padding:4px 0;">Reference</td><td style="padding:4px 0;text-align:right;color:#fff;">${order.reference}</td></tr><tr><td style="padding:4px 0;">Date</td><td style="padding:4px 0;text-align:right;color:#fff;">${order.paid_at || new Date().toISOString().slice(0,10)}</td></tr></table></div><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Your website download is available in your <a href="${APP_URL}/account.html" style="color:#fbbf24;">My Account</a> page.</p><p style="color:#9ca3af;font-size:13px;margin-top:16px;">Questions? WhatsApp +234 701 163 3770</p>`),
  };
}

function salaryEmail(staff, payment) {
  return {
    subject: `MITEX salary paid - ${payment.period}`,
    text: `Hi ${staff.name},\n\nYour salary has been recorded as paid:\n\nPeriod: ${payment.period}\nAmount: ${naira(payment.amount)}${payment.bonus ? `\nBonus:  ${naira(payment.bonus)}` : ""}${payment.note ? `\nNote:   ${payment.note}` : ""}\n\nKeep this email as your record. Questions? Talk to admin.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${staff.name},</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Your salary has been recorded as paid.</p><div style="background:#1f2937;border-radius:8px;padding:16px 20px;margin:16px 0;"><table style="width:100%;font-size:14px;color:#d1d5db;"><tr><td style="padding:4px 0;">Period</td><td style="padding:4px 0;text-align:right;color:#fff;">${payment.period}</td></tr><tr><td style="padding:4px 0;">Amount</td><td style="padding:4px 0;text-align:right;color:#fbbf24;font-weight:700;">${naira(payment.amount)}</td></tr>${payment.bonus ? `<tr><td style="padding:4px 0;">Bonus</td><td style="padding:4px 0;text-align:right;color:#10b981;">${naira(payment.bonus)}</td></tr>` : ""}${payment.note ? `<tr><td style="padding:4px 0;">Note</td><td style="padding:4px 0;text-align:right;color:#fff;">${payment.note}</td></tr>` : ""}</table></div><p style="color:#9ca3af;font-size:13px;">Keep this email as your record.</p>`),
  };
}

function deliveryEmail(buyer, order) {
  return {
    subject: `MITEX delivery ready - ${order.title}`,
    text: `Hi ${buyer.name},\n\nGreat news! The website you purchased is ready for download.\n\nOrder: ${order.title}\n\nDownload your website from your account:\n${APP_URL}/account.html\n\nIf you need help, WhatsApp +234 701 163 3770.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${buyer.name},</p><p style="color:#10b981;font-size:16px;font-weight:700;">Your website is ready!</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">The website you purchased (<strong style="color:#fff;">${order.title}</strong>) is now available for download.</p>${emailBtn(APP_URL + "/account.html", "Download Now")}<p style="color:#9ca3af;font-size:13px;margin-top:20px;">If you need help, WhatsApp +234 701 163 3770</p>`),
  };
}

// Worker notification: a buyer confirmed intent on a listing with no delivery link yet.
function buyerWaitingEmail(worker, listing) {
  return {
    subject: `Buyer waiting on "${listing.title}"`,
    text: `Hi ${worker.name},\n\nA buyer is ready to purchase "${listing.title}" and is waiting for you to add the website's delivery link.\n\nAction: Add the delivery link in your staff dashboard as soon as you're done. The buyer will be notified automatically.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${worker.name},</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">A buyer is ready to purchase <strong style="color:#fff;">"${listing.title}"</strong> and is waiting for the delivery link.</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Add the delivery link in your <a href="${APP_URL}/worker.html" style="color:#fbbf24;">staff dashboard</a> as soon as you're done - the buyer will be notified automatically.</p>`),
  };
}

// Buyer notification: their not-ready listing now has a delivery link.
function listingReadyEmail(buyer, listing) {
  return {
    subject: `"${listing.title}" is ready to buy`,
    text: `Hi ${buyer.name},\n\nGreat news! The website you were waiting for is now ready to buy.\n\nWebsite: ${listing.title}\n\nComplete your purchase here:\n${APP_URL}/marketplace.html\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${buyer.name},</p><p style="color:#10b981;font-size:16px;font-weight:700;">Good news!</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">The website you were waiting for (<strong style="color:#fff;">"${listing.title}"</strong>) is now ready to buy.</p>${emailBtn(APP_URL + "/marketplace.html", "Buy Now")}`),
  };
}

function enquiryReply(enquiry) {
  return {
    subject: `MITEX - we received your enquiry`,
    text: `Hi ${enquiry.name},\n\nThank you for reaching out! We have received your enquiry and will get back to you within 24 hours.\n\nYour message:\n${enquiry.message}\n\nNeed faster help? WhatsApp +234 701 163 3770.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${enquiry.name},</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Thank you for reaching out! We've received your enquiry and will get back to you within 24 hours.</p><div style="background:#1f2937;border-radius:8px;padding:16px 20px;margin:16px 0;"><p style="color:#9ca3af;font-size:12px;margin:0 0 6px;">YOUR MESSAGE</p><p style="color:#d1d5db;font-size:14px;line-height:1.6;margin:0;">${(enquiry.message || "").replace(/\n/g, "<br/>")}</p></div><p style="color:#9ca3af;font-size:13px;margin-top:16px;">Need faster help? WhatsApp +234 701 163 3770</p>`),
  };
}

function refundEmail(user, order) {
  return {
    subject: `MITEX refund processed - ${order.title}`,
    text: `Hi ${user.name},\n\nYour refund for "${order.title}" (${order.reference}) has been processed.\n\nThe refund will appear in your account within 5-10 business days.\n\nQuestions? Reply to this email or WhatsApp +234 701 163 3770.\n\n- MITEX team`,
    html: emailWrap(`<p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Hi ${user.name},</p><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">Your refund has been processed.</p><div style="background:#1f2937;border-radius:8px;padding:16px 20px;margin:16px 0;"><table style="width:100%;font-size:14px;color:#d1d5db;"><tr><td style="padding:4px 0;">Order</td><td style="padding:4px 0;text-align:right;color:#fff;">${order.title}</td></tr><tr><td style="padding:4px 0;">Reference</td><td style="padding:4px 0;text-align:right;color:#fff;">${order.reference}</td></tr><tr><td style="padding:4px 0;">Amount</td><td style="padding:4px 0;text-align:right;color:#fbbf24;font-weight:700;">${naira(order.amount)}</td></tr></table></div><p style="color:#e5e7eb;font-size:15px;line-height:1.6;">The refund will appear in your account within <strong>5-10 business days</strong>.</p><p style="color:#9ca3af;font-size:13px;margin-top:16px;">Questions? Reply to this email or WhatsApp +234 701 163 3770</p>`),
  };
}

module.exports = { sendMail, verificationEmail, resetEmail, testEmail, hireEmail, receiptEmail, salaryEmail, deliveryEmail, enquiryReply, refundEmail, buyerWaitingEmail, listingReadyEmail, smtpConfigured, libraryLoaded, APP_URL };
