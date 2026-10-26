import './env.js';

// Central place for every setting that comes from the environment.
const bool = (v, fallback) =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT || 4000);

// Leave empty when the frontend and API share one origin (Vite proxy / reverse proxy).
// Set to the exact frontend URL (e.g. https://docs.myschool.edu) to allow cross-origin calls.
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

// Fees are switched off. Prices stay in the database; set FEES_ENABLED=true to show them again.
export const FEES_ENABLED = bool(process.env.FEES_ENABLED, false);

// The public "track my request" search on the front page.
export const PUBLIC_TRACKING = bool(process.env.PUBLIC_TRACKING, true);

// Set to true only when running behind a reverse proxy you control (nginx, Render, Railway...).
export const TRUST_PROXY = bool(process.env.TRUST_PROXY, false);

export const MAX_BATCH_ITEMS = 10;

// ---- email (Nodemailer + Gmail SMTP) ----
// Public address users open the links from. This is where /verify-email, /forgot-password and
// /reset-password are served, so it must be the site users visit (frontend URL when the frontend
// proxies those paths to this API, otherwise this API's own URL).
export const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
// Where the "Go to login" button on those pages sends people.
export const LOGIN_URL = process.env.LOGIN_URL || CORS_ORIGIN || APP_URL;

export const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
export const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
export const SMTP_SECURE = bool(process.env.SMTP_SECURE, SMTP_PORT === 465);
export const SMTP_USER = process.env.SMTP_USER || '';
export const SMTP_PASS = (process.env.SMTP_PASS || '').replace(/\s+/g, ''); // Gmail shows app passwords with spaces
export const MAIL_FROM = process.env.MAIL_FROM || (SMTP_USER ? `"Document Request System" <${SMTP_USER}>` : '');

// How long the one-time links stay valid.
export const VERIFY_TTL_HOURS = Number(process.env.VERIFY_TTL_HOURS || 24);
export const RESET_TTL_MINUTES = Number(process.env.RESET_TTL_MINUTES || 30);
