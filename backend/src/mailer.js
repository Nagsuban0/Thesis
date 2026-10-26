import nodemailer from 'nodemailer';
import {
  IS_PROD,
  APP_URL,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  VERIFY_TTL_HOURS,
  RESET_TTL_MINUTES,
} from './config.js';

// Credentials come only from the environment (.env). Nothing secret lives in the code.
const configured = Boolean(SMTP_USER && SMTP_PASS);
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export function mailConfigured() {
  return configured;
}

// Checks the SMTP login once at startup so a wrong app password is noticed immediately.
export async function verifyMailSetup() {
  if (!configured) {
    console.warn('[mail] SMTP_USER / SMTP_PASS are not set. Emails will NOT be sent.');
    return;
  }
  try {
    await getTransporter().verify();
    console.log(`[mail] SMTP ready (${SMTP_USER} via ${SMTP_HOST}:${SMTP_PORT})`);
  } catch (err) {
    console.error(`[mail] SMTP login failed: ${err.message}`);
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function sendMail({ to, subject, text, html, devLink }) {
  if (!configured) {
    console.warn(`[mail] Not configured, skipped email "${subject}" to ${to}`);
    // Convenience for local development only; never printed in production.
    if (!IS_PROD && devLink) console.warn(`[mail:dev] Link: ${devLink}`);
    return false;
  }
  await getTransporter().sendMail({ from: MAIL_FROM, to, subject, text, html });
  return true;
}

function layout(title, intro, buttonText, link, outro) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="480" style="max-width:480px;background:#ffffff;border-radius:8px;padding:32px">
<tr><td>
<h2 style="margin:0 0 16px;font-size:20px">${esc(title)}</h2>
<p style="margin:0 0 20px;line-height:1.5">${intro}</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;display:inline-block">${esc(buttonText)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.5">If the button does not work, copy this link into your browser:<br><a href="${esc(link)}" style="color:#2563eb;word-break:break-all">${esc(link)}</a></p>
<p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.5">${outro}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export const verifyLink = (token) => `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
export const resetLink = (token) => `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

export function sendVerificationEmail(user, token) {
  const link = verifyLink(token);
  return sendMail({
    to: user.email,
    subject: 'Verify your email address',
    devLink: link,
    text:
      `Hi ${user.full_name},\n\nThanks for registering. Please verify your email address by opening this link:\n${link}\n\n` +
      `The link is valid for ${VERIFY_TTL_HOURS} hours and can be used once.\n` +
      `If you did not create an account, you can ignore this email.`,
    html: layout(
      'Verify your email address',
      `Hi ${esc(user.full_name)}, thanks for registering. Please confirm your email address to activate your account.`,
      'Verify email',
      link,
      `This link is valid for ${VERIFY_TTL_HOURS} hours and can be used once. If you did not create an account, you can ignore this email.`
    ),
  });
}

export function sendPasswordResetEmail(user, token) {
  const link = resetLink(token);
  return sendMail({
    to: user.email,
    subject: 'Reset your password',
    devLink: link,
    text:
      `Hi ${user.full_name},\n\nWe received a request to reset your password. Open this link to choose a new one:\n${link}\n\n` +
      `The link is valid for ${RESET_TTL_MINUTES} minutes and can be used once.\n` +
      `If you did not ask for this, ignore this email; your password will stay the same.`,
    html: layout(
      'Reset your password',
      `Hi ${esc(user.full_name)}, we received a request to reset your password. Click the button below to choose a new one.`,
      'Reset password',
      link,
      `This link is valid for ${RESET_TTL_MINUTES} minutes and can be used once. If you did not ask for this, ignore this email and your password will stay the same.`
    ),
  });
}
