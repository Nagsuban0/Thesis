import { IS_PROD, TRUST_PROXY } from './config.js';

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  ...(IS_PROD ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
};

// Small in-memory fixed-window rate limiter (fine for a single server process).
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs).unref();

  return {
    hit(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return { ok: entry.count <= max, retryAfter: Math.max(1, Math.ceil((entry.reset - now) / 1000)) };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

export function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

// Returns an error message, or null when the password is acceptable.
export function validatePassword(password) {
  const p = String(password ?? '');
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (p.length > 128) return 'Password is too long';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain at least one letter and one number';
  return null;
}

// Escape % and _ so user input cannot act as a LIKE wildcard.
export const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// "Juan Dela Cruz" -> "Juan D. C."  (the public search must not reveal full names)
export function maskName(full = '') {
  const parts = String(full).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return [parts[0], ...parts.slice(1).map((p) => `${p[0].toUpperCase()}.`)].join(' ');
}

// "2019-0456" -> "*******56"
export function maskId(id) {
  const s = String(id || '');
  if (s.length <= 2) return s;
  return '*'.repeat(s.length - 2) + s.slice(-2);
}
