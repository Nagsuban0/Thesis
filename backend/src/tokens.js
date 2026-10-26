import { randomBytes, createHash } from 'node:crypto';
import { db } from './db.js';

// One-time tokens for email verification ('verify') and password reset ('reset').
// Only a SHA-256 hash is stored, so a leaked database cannot be used to build valid links.
const hash = (raw) => createHash('sha256').update(raw).digest('hex');

export function createToken(userId, purpose, ttlMs) {
  const raw = randomBytes(32).toString('base64url'); // 256 bits of randomness
  const now = Date.now();
  // Only the newest link works: older unused tokens of the same kind are revoked.
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(userId, purpose);
  db.prepare(
    'INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, purpose, hash(raw), now + ttlMs, now);
  return raw;
}

// Atomically marks the token as used. Returns the user id, or null if it is
// unknown, expired, already used, or meant for another purpose.
export function consumeToken(raw, purpose) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) return null;
  const now = Date.now();
  const row = db
    .prepare(
      `UPDATE email_tokens SET used_at = ?
       WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
       RETURNING user_id`
    )
    .get(now, hash(raw), purpose, now);
  return row ? row.user_id : null;
}

export function revokeTokens(userId, purpose) {
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(userId, purpose);
}

// Housekeeping: drop expired and used tokens.
function purge() {
  db.prepare('DELETE FROM email_tokens WHERE expires_at < ? OR used_at IS NOT NULL AND used_at < ?').run(
    Date.now(),
    Date.now() - 24 * 60 * 60 * 1000
  );
}
purge();
setInterval(purge, 60 * 60 * 1000).unref();
