import { db } from './db.js';
import { hashPassword } from './auth.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const rl = createInterface({ input: stdin, output: stdout });

try {
  const name = await rl.question('Full name: ');
  const email = (await rl.question('Email: ')).trim().toLowerCase();
  const password = await rl.question('Password: ');
  const roleInput = (
    await rl.question('Role (registrar/admin): ')
  ).trim().toLowerCase();

  if (!name.trim() || !email || !password) {
    throw new Error('Name, email, and password are required.');
  }

  if (!['registrar', 'admin'].includes(roleInput)) {
    throw new Error('Role must be registrar or admin.');
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email);

  if (existing) {
    throw new Error('An account with this email already exists.');
  }

  const info = db.prepare(`
    INSERT INTO users
      (full_name, email, student_no, course, password_hash, role, email_verified)
    VALUES (?, ?, NULL, NULL, ?, ?, 1)
  `).run(name.trim(), email, hashPassword(password), roleInput);

  console.log(`Account created successfully: ${email}`);
  console.log(`Role: ${roleInput}`);
  console.log(`User ID: ${info.lastInsertRowid}`);
} catch (error) {
  console.error('Could not create account:', error.message);
  process.exitCode = 1;
} finally {
  rl.close();
}