// Creates sample accounts and requests for trying out the system.
// Run:  npm run seed:demo      (safe to run more than once)
import { db } from './db.js';
import { hashPassword } from './auth.js';

const ACCOUNTS = [
  { name: 'Rosa Reyes', email: 'registrar@example.com', password: 'Registrar@123', role: 'registrar' },
  {
    name: 'Juan Dela Cruz',
    email: 'student@example.com',
    password: 'Student@123',
    role: 'client',
    student_no: '2024-0001',
    course: 'BS Information Technology',
  },
  {
    name: 'Maria Santos',
    email: 'alumni@example.com',
    password: 'Student@123',
    role: 'client',
    student_no: '2019-0456',
    course: 'BS Business Administration',
  },
];

const ids = {};
for (const a of ACCOUNTS) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(a.email);
  if (existing) {
    ids[a.email] = existing.id;
    continue;
  }
  const info = db
    .prepare(
      'INSERT INTO users (full_name, email, student_no, course, password_hash, role, email_verified) VALUES (?, ?, ?, ?, ?, ?, 1)'
    )
    .run(a.name, a.email, a.student_no || null, a.course || null, hashPassword(a.password), a.role);
  ids[a.email] = Number(info.lastInsertRowid);
  console.log(`created ${a.role}: ${a.email}`);
}

const docId = (name) => db.prepare('SELECT * FROM document_types WHERE name = ?').get(name);
const registrarId = ids['registrar@example.com'];

const SAMPLES = [
  ['student@example.com', 'Good Moral Certificate', 'Employment', ['pending']],
  ['student@example.com', 'Transcript of Records (TOR)', 'Transfer to another school', ['pending', 'approved']],
  ['alumni@example.com', 'Diploma', 'Job application abroad', ['pending', 'approved', 'processing']],
  ['alumni@example.com', 'Certificate of Graduation', 'Scholarship', ['pending', 'approved', 'processing', 'ready', 'released']],
];

let n = 0;
for (const [email, docName, purpose, steps] of SAMPLES) {
  const dt = docId(docName);
  if (!dt) continue; // document list was customised, skip
  const userId = ids[email];
  if (db.prepare('SELECT 1 FROM requests WHERE user_id = ? AND document_type_id = ?').get(userId, dt.id)) continue;

  const ref = `DOC-DEMO-${String(++n).padStart(4, '0')}${String(Date.now()).slice(-3)}`;
  const status = steps[steps.length - 1];
  const info = db
    .prepare(
      `INSERT INTO requests (reference_no, user_id, document_type_id, purpose, copies, status, total_fee)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
    .run(ref, userId, dt.id, purpose, status, dt.fee);
  for (const s of steps) {
    db.prepare('INSERT INTO status_history (request_id, status, remarks, changed_by) VALUES (?, ?, ?, ?)').run(
      info.lastInsertRowid,
      s,
      s === 'pending' ? 'Request submitted' : null,
      s === 'pending' ? userId : registrarId
    );
  }
  console.log(`created request: ${docName} (${status}) for ${email}`);
}

console.log(`
Sample logins
  Admin      admin@example.com      / Admin@123
  Registrar  registrar@example.com  / Registrar@123
  Student    student@example.com    / Student@123
  Alumni     alumni@example.com     / Student@123
`);
