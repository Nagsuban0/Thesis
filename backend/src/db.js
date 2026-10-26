import './env.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || resolve(__dirname, '../data/docreq.sqlite');
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const usersSql = (name) => `
CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  address TEXT,
  student_no TEXT,
  course TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','registrar','admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const requestsSql = (name) => `
CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  document_type_id INTEGER NOT NULL REFERENCES document_types(id),
  purpose TEXT NOT NULL,
  copies INTEGER NOT NULL DEFAULT 1,
  delivery_method TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_method IN ('pickup','delivery')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','processing','ready','released','rejected','cancelled')),
  admin_remarks TEXT,
  total_fee REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

db.exec(`
CREATE TABLE IF NOT EXISTS document_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  fee REAL NOT NULL DEFAULT 0,
  processing_days INTEGER NOT NULL DEFAULT 3,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  remarks TEXT,
  changed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- create tables, or migrate databases made by the earlier version ----
function tableSql(name) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql;
}

function rebuild(name, createSql) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  db.exec('PRAGMA foreign_keys = OFF; BEGIN;');
  try {
    db.exec(createSql(`${name}_new`));
    const shared = cols(name).filter((c) => cols(`${name}_new`).includes(c)).join(', ');
    db.exec(`INSERT INTO ${name}_new (${shared}) SELECT ${shared} FROM ${name}`);
    db.exec(`DROP TABLE ${name}; ALTER TABLE ${name}_new RENAME TO ${name}; COMMIT;`);
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

const existingUsers = tableSql('users');
if (!existingUsers) db.exec(usersSql('users'));
else if (!existingUsers.includes("'registrar'")) rebuild('users', usersSql);

const existingRequests = tableSql('requests');
if (!existingRequests) db.exec(requestsSql('requests'));
else if (!existingRequests.includes("'approved'")) rebuild('requests', requestsSql);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
`);

// ---- email verification + password reset ----
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  // Accounts that existed before this feature keep working: they are treated as verified once.
  db.exec('UPDATE users SET email_verified = 1');
}
if (!userCols.includes('password_changed_at')) {
  // Unix seconds. Login tokens issued before this moment are rejected (set on password reset).
  db.exec('ALTER TABLE users ADD COLUMN password_changed_at INTEGER');
}

db.exec(`
CREATE TABLE IF NOT EXISTS email_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, purpose);
`);

// ---- seed data ----
const SCHOOL_DOCUMENTS = [
  ['Good Moral Certificate', 'Certifies good moral character and conduct while enrolled.', 50, 2],
  ['Diploma', 'Certified copy of your diploma.', 150, 5],
  ['Transcript of Records (TOR)', 'Official record of all subjects taken and grades earned.', 200, 5],
  ['Certificate of Enrollment', 'Proof that you are currently enrolled.', 50, 1],
  ['Certificate of Graduation', 'Proof that you completed your program.', 100, 3],
  ['Certificate of Grades', 'Official grades for a given term.', 50, 2],
  ['Honorable Dismissal', 'Required when transferring to another school.', 150, 5],
];

function seed() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const isProd = process.env.NODE_ENV === 'production';
  // In production never fall back to a well-known password: generate a random one instead.
  const generated = !process.env.ADMIN_PASSWORD && isProd;
  const adminPass =
    process.env.ADMIN_PASSWORD || (generated ? randomBytes(9).toString('base64url') : 'Admin@123');
  if (!db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) {
    db.prepare(
      'INSERT INTO users (full_name, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 1)'
    ).run('System Administrator', adminEmail, hashPassword(adminPass), 'admin');
    console.log(`[seed] Admin account created: ${adminEmail}${generated || !isProd ? ` / ${adminPass}` : ''}`);
    if (generated) console.log('[seed] Save this generated password now and change it after your first login.');
  }

  const ins = db.prepare(
    'INSERT INTO document_types (name, description, fee, processing_days) VALUES (?, ?, ?, ?)'
  );
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM document_types').get();
  const oldDemo = db.prepare("SELECT id FROM document_types WHERE name = 'Barangay Clearance'").get();
  const noRequests = db.prepare('SELECT COUNT(*) AS c FROM requests').get().c === 0;

  // Replace the demo document list from the earlier version, but only if it was never used.
  if (c > 0 && oldDemo && noRequests) db.exec('DELETE FROM document_types');
  if (c === 0 || (oldDemo && noRequests)) for (const d of SCHOOL_DOCUMENTS) ins.run(...d);
}
seed();
