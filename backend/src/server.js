import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { db } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, DUMMY_HASH } from './auth.js';
import {
  PORT,
  FEES_ENABLED,
  PUBLIC_TRACKING,
  MAX_BATCH_ITEMS,
  VERIFY_TTL_HOURS,
  RESET_TTL_MINUTES,
} from './config.js';
import {
  createRateLimiter,
  clientIp,
  validatePassword,
  escapeLike,
  maskName,
  maskId,
} from './security.js';
import { HttpError, str, text, requireFields, send, sendHtml, readBody, createRouter } from './http.js';
import { createToken, consumeToken } from './tokens.js';
import { sendVerificationEmail, sendPasswordResetEmail, verifyMailSetup } from './mailer.js';
import { renderPage } from './pages.js';

const STATUSES = ['pending', 'approved', 'processing', 'ready', 'released', 'rejected', 'cancelled'];
const ACTIVE_STATUSES = ['pending', 'approved', 'processing', 'ready'];

// Allowed next steps for a request.
const TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['processing', 'rejected'],
  processing: ['ready', 'rejected'],
  ready: ['released'],
  released: [],
  rejected: [],
  cancelled: [],
};
const STAFF = ['admin', 'registrar'];
const ADMIN = ['admin'];
const CLIENT = ['client'];

// ---------- rate limits ----------
const limiters = {
  global: createRateLimiter({ windowMs: 60_000, max: 300 }), // every request, per IP
  loginIp: createRateLimiter({ windowMs: 15 * 60_000, max: 40 }), // login tries per IP
  login: createRateLimiter({ windowMs: 15 * 60_000, max: 8 }), // login tries per IP + email
  register: createRateLimiter({ windowMs: 60 * 60_000, max: 10 }),
  verify: createRateLimiter({ windowMs: 15 * 60_000, max: 30 }), // verification link attempts per IP
  forgot: createRateLimiter({ windowMs: 15 * 60_000, max: 10 }), // forgot / resend requests per IP
  mailPerEmail: createRateLimiter({ windowMs: 60 * 60_000, max: 3 }), // emails sent per address per hour
  reset: createRateLimiter({ windowMs: 15 * 60_000, max: 15 }), // reset link attempts per IP
  track: createRateLimiter({ windowMs: 60_000, max: 20 }), // public search
};

const tooMany = (retryAfter) =>
  new HttpError(429, 'Too many attempts. Please wait a moment and try again.', {
    'Retry-After': String(retryAfter),
  });

// ---------- helpers ----------
const publicUser = (u) => ({
  id: u.id,
  full_name: u.full_name,
  email: u.email,
  phone: u.phone,
  address: u.address,
  student_no: u.student_no,
  course: u.course,
  role: u.role,
  email_verified: !!u.email_verified,
  is_active: !!u.is_active,
  created_at: u.created_at,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_NO_RE = /^[A-Za-z0-9-]{3,20}$/;

function parseEmail(v) {
  const email = text(v, 120, 'email').toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Invalid email address');
  return email;
}

function parseStudentNo(v) {
  const s = text(v, 20, 'student_no');
  if (s && !STUDENT_NO_RE.test(s))
    throw new HttpError(400, 'School ID may only contain letters, numbers and dashes');
  return s || null;
}

function parsePassword(v) {
  const problem = validatePassword(v);
  if (problem) throw new HttpError(400, problem);
  return String(v);
}

// Sends an email in the background so the HTTP response time never reveals whether an
// address exists. Failures are logged, never shown to the caller.
function sendInBackground(job, label) {
  Promise.resolve()
    .then(job)
    .catch((err) => console.error(`[mail] Could not send ${label}: ${err.message}`));
}

function issueVerification(user) {
  const token = createToken(user.id, 'verify', VERIFY_TTL_HOURS * 3_600_000);
  sendInBackground(() => sendVerificationEmail(user, token), 'verification email');
}

const GENERIC_RESEND =
  'If that email belongs to an account that still needs verification, a new verification link has been sent.';
const GENERIC_FORGOT =
  'If that email is registered, a password reset link has been sent. Please check your inbox (and spam folder).';

function makeReferenceNo() {
  const year = new Date().getFullYear();
  for (let i = 0; i < 10; i++) {
    const ref = `DOC-${year}-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
    if (!db.prepare('SELECT 1 FROM requests WHERE reference_no = ?').get(ref)) return ref;
  }
  throw new HttpError(500, 'Could not generate reference number');
}

// Fees are hidden everywhere unless FEES_ENABLED=true (the stored prices are kept).
const FEE_COL = FEES_ENABLED ? 'dt.fee' : '0';
const TOTAL_COL = FEES_ENABLED ? 'r.total_fee' : '0';
const DOC_TYPE_COLS = `id, name, description, ${FEES_ENABLED ? 'fee' : '0'} AS fee, processing_days, is_active`;

const REQUEST_SELECT = `
  SELECT r.id, r.reference_no, r.user_id, r.document_type_id, r.purpose, r.copies,
         r.delivery_method, r.notes, r.status, r.admin_remarks, r.created_at, r.updated_at,
         ${TOTAL_COL} AS total_fee,
         dt.name AS document_name, ${FEE_COL} AS unit_fee,
         u.full_name AS client_name, u.email AS client_email,
         u.student_no AS client_student_no, u.course AS client_course
  FROM requests r
  JOIN document_types dt ON dt.id = r.document_type_id
  JOIN users u ON u.id = r.user_id
`;

function getRequestWithHistory(id) {
  const request = db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id);
  if (!request) return null;
  request.history = db
    .prepare(
      `SELECT h.status, h.remarks, h.created_at, u.full_name AS changed_by_name
       FROM status_history h LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.request_id = ? ORDER BY h.id ASC`
    )
    .all(id);
  return request;
}

function notifyStudent(request, status) {
  const what = `${request.document_name} (${request.reference_no})`;
  const messages = {
    pending: `Your request for ${what} was submitted. The registrar will review it.`,
    approved: `Your request for ${what} was approved.`,
    rejected: `Your request for ${what} was rejected.${request.admin_remarks ? ` Reason: ${request.admin_remarks}` : ''}`,
    processing: `The registrar is now processing your ${what}.`,
    ready:
      request.delivery_method === 'delivery'
        ? `Your ${what} is ready and will be delivered.`
        : `Your ${what} is ready for pick-up.`,
    released: `Your ${what} has been released.`,
    cancelled: `Your request for ${what} was cancelled.`,
  };
  if (!messages[status]) return;
  db.prepare('INSERT INTO notifications (user_id, request_id, message) VALUES (?, ?, ?)').run(
    request.user_id,
    request.id,
    messages[status]
  );
}

function addHistory(requestId, status, remarks, userId) {
  db.prepare(
    'INSERT INTO status_history (request_id, status, remarks, changed_by) VALUES (?, ?, ?, ?)'
  ).run(requestId, status, remarks || null, userId);
}

function parseCopies(v, label = '') {
  const copies = Number(v ?? 1);
  if (!Number.isInteger(copies) || copies < 1 || copies > 20)
    throw new HttpError(400, `${label}Copies must be a whole number between 1 and 20`);
  return copies;
}

function parseDelivery(v) {
  const delivery = str(v) || 'pickup';
  if (!['pickup', 'delivery'].includes(delivery))
    throw new HttpError(400, 'delivery_method must be pickup or delivery');
  return delivery;
}

function findActiveDocType(id) {
  return db.prepare('SELECT * FROM document_types WHERE id = ? AND is_active = 1').get(Number(id));
}

function findOpenRequest(userId, docTypeId) {
  return db
    .prepare(
      `SELECT reference_no FROM requests
       WHERE user_id = ? AND document_type_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`
    )
    .get(userId, docTypeId, ...ACTIVE_STATUSES);
}

function openRequestError(dt, open) {
  return new HttpError(
    409,
    `You already have an active request for ${dt.name} (${open.reference_no}). Wait until it is released or cancel it first.`
  );
}

function insertRequest(user, dt, { purpose, copies, delivery, notes }) {
  const info = db
    .prepare(
      `INSERT INTO requests
       (reference_no, user_id, document_type_id, purpose, copies, delivery_method, notes, total_fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(makeReferenceNo(), user.id, dt.id, purpose, copies, delivery, notes, dt.fee * copies);
  addHistory(info.lastInsertRowid, 'pending', 'Request submitted', user.id);
  const created = getRequestWithHistory(info.lastInsertRowid);
  notifyStudent(created, 'pending');
  return created;
}

function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- routes ----------
const router = createRouter();
const route = (method, path, opts, handler) => router.add(method, path, opts, handler);

// ----- public: track a request by School ID or last name -----
route('GET', '/api/public/track', { limiter: limiters.track }, ({ query }) => {
  if (!PUBLIC_TRACKING) throw new HttpError(404, 'Not found');
  const q = str(query.q);
  if (q.length < 3) throw new HttpError(400, 'Please enter at least 3 characters');
  if (q.length > 40) throw new HttpError(400, 'Search text is too long');

  const base = "SELECT id, full_name, student_no, course FROM users WHERE role = 'client' AND is_active = 1";
  let students;
  if (/\d/.test(q)) {
    // School ID: exact match, ignoring dashes and spaces ("2019-0456" = "20190456").
    const norm = q.toLowerCase().replace(/[\s-]/g, '');
    students = db
      .prepare(`${base} AND replace(replace(lower(student_no), '-', ''), ' ', '') = ? LIMIT 5`)
      .all(norm);
  } else {
    // Last name: the last word of the stored name must match.
    const like = escapeLike(q.toLowerCase());
    students = db
      .prepare(
        `${base} AND (lower(full_name) LIKE ? ESCAPE '\\' OR lower(full_name) LIKE ? ESCAPE '\\')
         ORDER BY full_name LIMIT 5`
      )
      .all(`% ${like}`, `${like},%`);
  }

  const results = students.map((s) => ({
    student: { name: maskName(s.full_name), student_no: maskId(s.student_no), course: s.course },
    requests: db
      .prepare(
        `SELECT r.reference_no, r.status, r.copies, r.delivery_method, r.created_at, r.updated_at,
                dt.name AS document_name
         FROM requests r JOIN document_types dt ON dt.id = r.document_type_id
         WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 30`
      )
      .all(s.id),
  }));
  return { results };
});

// ----- auth -----
route('POST', '/api/auth/register', { limiter: limiters.register }, ({ body }) => {
  requireFields(body, ['full_name', 'email', 'password']);
  const email = parseEmail(body.email);
  const password = parsePassword(body.password);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    throw new HttpError(409, 'Email is already registered');

  const info = db
    .prepare(
      'INSERT INTO users (full_name, email, phone, address, student_no, course, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      text(body.full_name, 100, 'full_name'),
      email,
      text(body.phone, 30, 'phone') || null,
      text(body.address, 200, 'address') || null,
      parseStudentNo(body.student_no),
      text(body.course, 100, 'course') || null,
      hashPassword(password)
    );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  // No login token yet: the email has to be verified first.
  issueVerification(user);
  return [
    201,
    {
      verification_required: true,
      email: user.email,
      message: 'Account created. Please check your email and click the verification link before logging in.',
      user: publicUser(user),
    },
  ];
});

route('POST', '/api/auth/login', { limiter: limiters.loginIp }, ({ body, ip }) => {
  requireFields(body, ['email', 'password']);
  const email = str(body.email).toLowerCase().slice(0, 120);
  const password = String(body.password).slice(0, 129);
  const key = `${ip}|${email}`;
  const attempt = limiters.login.hit(key);
  if (!attempt.ok) throw tooMany(attempt.retryAfter);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const valid = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid || password.length > 128) throw new HttpError(401, 'Invalid email or password');
  if (!user.is_active) throw new HttpError(403, 'This account has been deactivated');
  if (!user.email_verified)
    throw new HttpError(
      403,
      'Please verify your email address first. Check your inbox for the verification link.',
      {},
      'EMAIL_NOT_VERIFIED'
    );

  limiters.login.reset(key);
  return { token: signToken({ sub: user.id, role: user.role }), user: publicUser(user) };
});

// ----- email verification -----
route('POST', '/api/auth/verify-email', { limiter: limiters.verify }, ({ body }) => {
  const token = str(body.token);
  const userId = inTransaction(() => {
    const id = consumeToken(token, 'verify');
    if (id) db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id);
    return id;
  });
  if (!userId)
    throw new HttpError(400, 'This verification link is invalid or has expired.', {}, 'INVALID_TOKEN');
  return { ok: true, message: 'Email verified. You can now log in.' };
});

route('POST', '/api/auth/resend-verification', { limiter: limiters.forgot }, ({ body }) => {
  requireFields(body, ['email']);
  const email = str(body.email).toLowerCase().slice(0, 120);
  // Same answer whether or not the account exists, is verified, or was rate limited.
  if (EMAIL_RE.test(email) && limiters.mailPerEmail.hit(`verify|${email}`).ok) {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user && user.is_active && !user.email_verified) issueVerification(user);
  }
  return { ok: true, message: GENERIC_RESEND };
});

// ----- forgot / reset password -----
route('POST', '/api/auth/forgot-password', { limiter: limiters.forgot }, ({ body }) => {
  requireFields(body, ['email']);
  const email = str(body.email).toLowerCase().slice(0, 120);
  // Always the same response, so nobody can discover which emails are registered.
  if (EMAIL_RE.test(email) && limiters.mailPerEmail.hit(`reset|${email}`).ok) {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user && user.is_active) {
      const token = createToken(user.id, 'reset', RESET_TTL_MINUTES * 60_000);
      sendInBackground(() => sendPasswordResetEmail(user, token), 'password reset email');
    }
  }
  return { ok: true, message: GENERIC_FORGOT };
});

route('POST', '/api/auth/reset-password', { limiter: limiters.reset }, ({ body }) => {
  requireFields(body, ['token', 'new_password']);
  const password = parsePassword(body.new_password); // a weak password does not burn the link
  const userId = inTransaction(() => {
    const id = consumeToken(str(body.token), 'reset');
    if (!id) return null;
    // Opening the emailed link also proves the address is real, so the account becomes verified.
    db.prepare(
      'UPDATE users SET password_hash = ?, email_verified = 1, password_changed_at = ? WHERE id = ?'
    ).run(hashPassword(password), Math.floor(Date.now() / 1000), id);
    return id;
  });
  if (!userId) throw new HttpError(400, 'This reset link is invalid or has expired.', {}, 'INVALID_TOKEN');
  return { ok: true, message: 'Your password has been updated. You can now log in with it.' };
});

route('GET', '/api/auth/me', { auth: true }, ({ user }) => ({ user: publicUser(user) }));

route('PATCH', '/api/auth/me', { auth: true }, ({ user, body }) => {
  const full_name = text(body.full_name, 100, 'full_name') || user.full_name;
  const phone = body.phone !== undefined ? text(body.phone, 30, 'phone') || null : user.phone;
  const address = body.address !== undefined ? text(body.address, 200, 'address') || null : user.address;
  const student_no = body.student_no !== undefined ? parseStudentNo(body.student_no) : user.student_no;
  const course = body.course !== undefined ? text(body.course, 100, 'course') || null : user.course;
  db.prepare(
    'UPDATE users SET full_name = ?, phone = ?, address = ?, student_no = ?, course = ? WHERE id = ?'
  ).run(full_name, phone, address, student_no, course, user.id);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) };
});

route('POST', '/api/auth/change-password', { auth: true, limiter: limiters.loginIp }, ({ user, body }) => {
  requireFields(body, ['current_password', 'new_password']);
  if (!verifyPassword(String(body.current_password).slice(0, 129), user.password_hash))
    throw new HttpError(400, 'Current password is incorrect');
  const next = parsePassword(body.new_password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
  return { ok: true };
});

// ----- document types (any logged-in user) -----
route('GET', '/api/document-types', { auth: true }, () => ({
  document_types: db
    .prepare(`SELECT ${DOC_TYPE_COLS} FROM document_types WHERE is_active = 1 ORDER BY name`)
    .all(),
}));

// ----- client requests -----
route('GET', '/api/requests', { auth: true }, ({ user }) => ({
  requests: db.prepare(`${REQUEST_SELECT} WHERE r.user_id = ? ORDER BY r.id DESC`).all(user.id),
}));

route('POST', '/api/requests', { auth: true, roles: CLIENT }, ({ user, body }) => {
  const dt = findActiveDocType(body.document_type_id);
  if (!dt) throw new HttpError(400, 'Invalid document type');
  const open = findOpenRequest(user.id, dt.id);
  if (open) throw openRequestError(dt, open);
  const created = insertRequest(user, dt, {
    purpose: text(body.purpose, 200, 'purpose') || 'Not specified',
    copies: parseCopies(body.copies),
    delivery: parseDelivery(body.delivery_method),
    notes: text(body.notes, 500, 'notes') || null,
  });
  return [201, { request: created }];
});

// Several documents in one go. All succeed or none are saved.
route('POST', '/api/requests/batch', { auth: true, roles: CLIENT }, ({ user, body }) => {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new HttpError(400, 'Add at least one document');
  if (items.length > MAX_BATCH_ITEMS)
    throw new HttpError(400, `You can request up to ${MAX_BATCH_ITEMS} documents at a time`);

  const shared = {
    purpose: text(body.purpose, 200, 'purpose') || 'Not specified',
    delivery: parseDelivery(body.delivery_method),
    notes: text(body.notes, 500, 'notes') || null,
  };

  const seen = new Set();
  const prepared = items.map((item, i) => {
    const label = `Document ${i + 1}: `;
    const dt = findActiveDocType(item?.document_type_id);
    if (!dt) throw new HttpError(400, `${label}invalid document type`);
    if (seen.has(dt.id)) throw new HttpError(400, `${dt.name} is listed more than once`);
    seen.add(dt.id);
    const open = findOpenRequest(user.id, dt.id);
    if (open) throw openRequestError(dt, open);
    return { dt, copies: parseCopies(item.copies, label) };
  });

  const created = inTransaction(() =>
    prepared.map(({ dt, copies }) => insertRequest(user, dt, { ...shared, copies }))
  );
  return [201, { requests: created }];
});

route('GET', '/api/requests/:id', { auth: true }, ({ user, params }) => {
  const request = getRequestWithHistory(Number(params.id));
  if (!request || (!STAFF.includes(user.role) && request.user_id !== user.id))
    throw new HttpError(404, 'Request not found');
  return { request };
});

route('POST', '/api/requests/:id/cancel', { auth: true }, ({ user, params }) => {
  const id = Number(params.id);
  const r = db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!r) throw new HttpError(404, 'Request not found');
  if (r.status !== 'pending') throw new HttpError(400, 'Only pending requests can be cancelled');
  db.prepare("UPDATE requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(id);
  addHistory(id, 'cancelled', 'Cancelled by client', user.id);
  const cancelled = getRequestWithHistory(id);
  notifyStudent(cancelled, 'cancelled');
  return { request: cancelled };
});

// ----- staff -----
route('GET', '/api/admin/stats', { auth: true, roles: STAFF }, () => {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM requests GROUP BY status').all())
    byStatus[row.status] = row.c;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const revenue = FEES_ENABLED
    ? db.prepare("SELECT COALESCE(SUM(total_fee), 0) AS s FROM requests WHERE status = 'released'").get().s
    : 0;
  const clients = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'client'").get().c;
  const recent = db.prepare(`${REQUEST_SELECT} ORDER BY r.id DESC LIMIT 5`).all();
  const topDocuments = db
    .prepare(
      `SELECT dt.name, COUNT(*) AS count FROM requests r
       JOIN document_types dt ON dt.id = r.document_type_id
       GROUP BY dt.id ORDER BY count DESC LIMIT 5`
    )
    .all();
  return { total, by_status: byStatus, revenue, clients, recent, top_documents: topDocuments };
});

route('GET', '/api/admin/requests', { auth: true, roles: STAFF }, ({ query }) => {
  const where = [];
  const args = [];
  if (query.status) {
    if (!STATUSES.includes(query.status)) throw new HttpError(400, 'Invalid status filter');
    where.push('r.status = ?');
    args.push(query.status);
  }
  if (query.q) {
    where.push(
      "(r.reference_no LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.student_no LIKE ? ESCAPE '\\' OR dt.name LIKE ? ESCAPE '\\')"
    );
    const like = `%${escapeLike(String(query.q).slice(0, 60))}%`;
    args.push(like, like, like, like, like);
  }
  const sql = `${REQUEST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC`;
  return { requests: db.prepare(sql).all(...args) };
});

route('PATCH', '/api/admin/requests/:id', { auth: true, roles: STAFF }, ({ user, params, body }) => {
  const id = Number(params.id);
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Request not found');
  const status = str(body.status) || r.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  if (status !== r.status) {
    if (!TRANSITIONS[r.status].includes(status))
      throw new HttpError(
        400,
        TRANSITIONS[r.status].length
          ? `A ${r.status} request can only move to: ${TRANSITIONS[r.status].join(', ')}`
          : `A ${r.status} request can no longer change status`
      );
  } else if (['released', 'rejected', 'cancelled'].includes(r.status)) {
    throw new HttpError(400, `A ${r.status} request can no longer be changed`);
  }
  const remarks =
    body.admin_remarks !== undefined ? text(body.admin_remarks, 500, 'admin_remarks') || null : r.admin_remarks;
  if (status === 'rejected' && !remarks)
    throw new HttpError(400, 'Please provide a reason (admin_remarks) when rejecting');

  db.prepare(
    "UPDATE requests SET status = ?, admin_remarks = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, remarks, id);
  if (status !== r.status || remarks !== r.admin_remarks) addHistory(id, status, remarks, user.id);
  const updated = getRequestWithHistory(id);
  if (status !== r.status) notifyStudent(updated, status);
  return { request: updated };
});

// ----- notifications (for the logged-in user) -----
route('GET', '/api/notifications', { auth: true }, ({ user }) => ({
  notifications: db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30')
    .all(user.id)
    .map((n) => ({ ...n, is_read: !!n.is_read })),
  unread_count: db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(user.id).c,
}));

route('POST', '/api/notifications/read', { auth: true }, ({ user }) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(user.id);
  return { ok: true };
});

// ----- admin only -----
route('GET', '/api/admin/document-types', { auth: true, roles: ADMIN }, () => ({
  document_types: db.prepare(`SELECT ${DOC_TYPE_COLS} FROM document_types ORDER BY name`).all(),
}));

function parseDocType(body, existing = {}) {
  const name = text(body.name, 100, 'name') || existing.name;
  if (!name) throw new HttpError(400, 'name is required');
  // While fees are disabled the stored price is left untouched.
  const fee = !FEES_ENABLED ? existing.fee ?? 0 : body.fee !== undefined ? Number(body.fee) : existing.fee ?? 0;
  const days = body.processing_days !== undefined ? Number(body.processing_days) : existing.processing_days ?? 3;
  if (!Number.isFinite(fee) || fee < 0) throw new HttpError(400, 'fee must be 0 or more');
  if (!Number.isInteger(days) || days < 0 || days > 365)
    throw new HttpError(400, 'processing_days must be a whole number');
  return {
    name,
    description:
      body.description !== undefined ? text(body.description, 300, 'description') || null : existing.description ?? null,
    fee,
    processing_days: days,
    is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active ?? 1,
  };
}

route('POST', '/api/admin/document-types', { auth: true, roles: ADMIN }, ({ body }) => {
  const d = parseDocType(body);
  if (db.prepare('SELECT 1 FROM document_types WHERE name = ?').get(d.name))
    throw new HttpError(409, 'A document type with that name already exists');
  const info = db
    .prepare(
      'INSERT INTO document_types (name, description, fee, processing_days, is_active) VALUES (?, ?, ?, ?, ?)'
    )
    .run(d.name, d.description, d.fee, d.processing_days, d.is_active);
  return [
    201,
    { document_type: db.prepare(`SELECT ${DOC_TYPE_COLS} FROM document_types WHERE id = ?`).get(info.lastInsertRowid) },
  ];
});

route('PATCH', '/api/admin/document-types/:id', { auth: true, roles: ADMIN }, ({ params, body }) => {
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM document_types WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Document type not found');
  const d = parseDocType(body, existing);
  const dup = db.prepare('SELECT id FROM document_types WHERE name = ? AND id != ?').get(d.name, id);
  if (dup) throw new HttpError(409, 'A document type with that name already exists');
  db.prepare(
    'UPDATE document_types SET name = ?, description = ?, fee = ?, processing_days = ?, is_active = ? WHERE id = ?'
  ).run(d.name, d.description, d.fee, d.processing_days, d.is_active, id);
  return { document_type: db.prepare(`SELECT ${DOC_TYPE_COLS} FROM document_types WHERE id = ?`).get(id) };
});

route('DELETE', '/api/admin/document-types/:id', { auth: true, roles: ADMIN }, ({ params }) => {
  const id = Number(params.id);
  const used = db.prepare('SELECT 1 FROM requests WHERE document_type_id = ? LIMIT 1').get(id);
  if (used) {
    // Keep history intact: deactivate instead of deleting.
    db.prepare('UPDATE document_types SET is_active = 0 WHERE id = ?').run(id);
    return { deactivated: true };
  }
  const info = db.prepare('DELETE FROM document_types WHERE id = ?').run(id);
  if (!info.changes) throw new HttpError(404, 'Document type not found');
  return { deleted: true };
});

route('GET', '/api/admin/users', { auth: true, roles: ADMIN }, () => ({
  users: db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM requests r WHERE r.user_id = u.id) AS request_count
       FROM users u ORDER BY u.id DESC`
    )
    .all()
    .map((u) => ({ ...publicUser(u), request_count: u.request_count })),
}));

route('PATCH', '/api/admin/users/:id', { auth: true, roles: ADMIN }, ({ user, params, body }) => {
  const id = Number(params.id);
  if (id === user.id) throw new HttpError(400, 'You cannot change your own account status');
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new HttpError(404, 'User not found');
  if (target.role === 'admin') throw new HttpError(403, 'Admin accounts cannot be changed here');
  if (body.is_active === undefined && body.new_password === undefined && body.full_name === undefined)
    throw new HttpError(400, 'Nothing to update');

  // Validate everything first, then write.
  const fullName = body.full_name !== undefined ? text(body.full_name, 100, 'full_name') : null;
  if (body.full_name !== undefined && !fullName) throw new HttpError(400, 'full_name cannot be empty');
  const newPassword = body.new_password !== undefined ? parsePassword(body.new_password) : null;

  if (body.is_active !== undefined)
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(body.is_active ? 1 : 0, id);
  if (fullName) db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(fullName, id);
  if (newPassword)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), id);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) };
});

// Admin creates and controls registrar (staff) accounts.
route('POST', '/api/admin/registrars', { auth: true, roles: ADMIN }, ({ body }) => {
  requireFields(body, ['full_name', 'email', 'password']);
  const email = parseEmail(body.email);
  const password = parsePassword(body.password);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    throw new HttpError(409, 'Email is already registered');
  const info = db
    .prepare("INSERT INTO users (full_name, email, phone, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 'registrar', 1)")
    .run(text(body.full_name, 100, 'full_name'), email, text(body.phone, 30, 'phone') || null, hashPassword(password));
  return [201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) }];
});

// ---------- server ----------
const server = createServer(async (req, res) => {
  const ip = clientIp(req);
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const overall = limiters.global.hit(ip);
    if (!overall.ok) throw tooMany(overall.retryAfter);

    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/api/health') return send(res, 200, { ok: true });

    // Pages opened from the emailed links.
    if (req.method === 'GET') {
      const page = renderPage(path);
      if (page) return sendHtml(res, page.html, page.csp);
    }

    const { route: matched, params } = router.match(req.method, path);
    if (matched.limiter) {
      const l = matched.limiter.hit(ip);
      if (!l.ok) throw tooMany(l.retryAfter);
    }

    let user = null;
    if (matched.auth) {
      const header = req.headers.authorization || '';
      const payload = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
      if (!payload) throw new HttpError(401, 'Authentication required');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      if (!user || !user.is_active) throw new HttpError(401, 'Account not available');
      if (!user.email_verified)
        throw new HttpError(403, 'Please verify your email address first.', {}, 'EMAIL_NOT_VERIFIED');
      // A password reset signs out every session that started before it.
      if (user.password_changed_at && payload.iat < user.password_changed_at)
        throw new HttpError(401, 'Authentication required');
      if (matched.roles && !matched.roles.includes(user.role))
        throw new HttpError(403, 'You do not have access to this');
    }

    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const out = await matched.handler({
      user,
      body,
      params,
      ip,
      query: Object.fromEntries(url.searchParams),
    });
    if (Array.isArray(out)) send(res, out[0], out[1]);
    else send(res, 200, out);
  } catch (err) {
    if (err instanceof HttpError)
      return send(res, err.status, err.code ? { error: err.message, code: err.code } : { error: err.message }, err.headers);
    console.error(err);
    send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  verifyMailSetup();
});

export { server };
