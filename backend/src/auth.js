import './env.js';
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const IS_PROD = process.env.NODE_ENV === 'production';
const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours

let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (IS_PROD) throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  SECRET = 'dev-only-secret-change-me';
  console.warn('[warn] JWT_SECRET is not set. Using an insecure development secret.');
} else if (IS_PROD && SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Used so a login for an unknown email takes as long as a real one (no account enumeration by timing).
export const DUMMY_HASH = hashPassword(randomBytes(8).toString('hex'));

const b64url = (input) => Buffer.from(input).toString('base64url');

export function signToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (parsedHeader.alg !== 'HS256') return null;
    const expected = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
