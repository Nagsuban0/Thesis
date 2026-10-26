import { randomBytes } from 'node:crypto';
import { LOGIN_URL } from './config.js';

// Small self-contained pages opened from the emailed links. They call the JSON API on the same origin.
// Colors live in the :root block below so they are easy to match with the main site.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
:root{--bg:#f4f5f7;--card:#fff;--text:#1f2937;--muted:#6b7280;--primary:#2563eb;--primary-text:#fff;--border:#d1d5db;--ok:#15803d;--err:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#111827;--card:#1f2937;--text:#f3f4f6;--muted:#9ca3af;--border:#374151;--ok:#4ade80;--err:#f87171}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
main{width:100%;max-width:420px;background:var(--card);border-radius:10px;padding:32px;box-shadow:0 4px 18px rgba(0,0,0,.08)}
h1{margin:0 0 8px;font-size:22px}
p{line-height:1.5;margin:0 0 16px}
.muted{color:var(--muted);font-size:14px}
label{display:block;font-size:14px;margin:0 0 6px}
input{width:100%;padding:10px 12px;margin:0 0 14px;border:1px solid var(--border);border-radius:6px;font-size:15px;background:transparent;color:var(--text)}
button,.btn{display:inline-block;width:100%;padding:11px 16px;border:0;border-radius:6px;background:var(--primary);color:var(--primary-text);font-size:15px;text-align:center;text-decoration:none;cursor:pointer}
button[disabled]{opacity:.6;cursor:default}
a{color:var(--primary)}
.msg{padding:10px 12px;border-radius:6px;margin:0 0 16px;font-size:14px}
.msg.ok{color:var(--ok);border:1px solid var(--ok)}
.msg.err{color:var(--err);border:1px solid var(--err)}
.hidden{display:none}
.links{margin-top:16px;text-align:center;font-size:14px}
`;

const COMMON_JS = `
const $ = (id) => document.getElementById(id);
const loginUrl = document.body.dataset.login;
async function api(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Cannot reach the server. Check your connection and try again.' } };
  }
}
function show(el, kind, text) { el.className = 'msg ' + kind; el.textContent = text; }
function tokenFromUrl() {
  const t = new URLSearchParams(location.search).get('token') || '';
  if (t) history.replaceState(null, '', location.pathname); // keep the secret out of the address bar
  return t;
}
function loginLink(box) {
  const a = document.createElement('a');
  a.className = 'btn'; a.href = loginUrl; a.textContent = 'Go to login';
  box.appendChild(a);
}
`;

function shell({ title, nonce, body, script }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style nonce="${nonce}">${STYLE}</style></head>
<body data-login="${esc(LOGIN_URL)}"><main>${body}<noscript><p class="msg err">Please enable JavaScript to use this page.</p></noscript></main>
<script nonce="${nonce}">${COMMON_JS}${script}</script></body></html>`;
}

const RESEND_FORM = `
<form id="resendForm" class="hidden" novalidate>
  <p class="muted">Need a new link? Enter your email and we will send another one.</p>
  <label for="resendEmail">Email</label>
  <input id="resendEmail" type="email" autocomplete="email" required>
  <button type="submit">Send new verification email</button>
</form>`;

const PAGES = {
  '/verify-email': (nonce) =>
    shell({
      title: 'Verify email',
      nonce,
      body: `<h1>Email verification</h1><div id="msg" class="msg ok">Verifying your email…</div><div id="after"></div>${RESEND_FORM}`,
      script: `
const msg = $('msg'), form = $('resendForm');
(async () => {
  const token = tokenFromUrl();
  if (!token) { show(msg, 'err', 'This verification link is incomplete.'); form.classList.remove('hidden'); return; }
  const r = await api('/api/auth/verify-email', { token });
  if (r.ok) { show(msg, 'ok', 'Your email is verified. You can now log in.'); loginLink($('after')); }
  else { show(msg, 'err', r.data.error || 'This link is invalid or has expired.'); form.classList.remove('hidden'); }
})();
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('button'); btn.disabled = true;
  const r = await api('/api/auth/resend-verification', { email: $('resendEmail').value });
  show(msg, r.ok ? 'ok' : 'err', r.data.message || r.data.error || 'Something went wrong.');
  btn.disabled = false;
});`,
    }),

  '/forgot-password': (nonce) =>
    shell({
      title: 'Forgot password',
      nonce,
      body: `<h1>Forgot your password?</h1>
<p class="muted">Enter your account email and we will send you a link to reset it.</p>
<div id="msg" class="hidden"></div>
<form id="form" novalidate>
  <label for="email">Email</label>
  <input id="email" type="email" autocomplete="email" required>
  <button type="submit">Send reset link</button>
</form>
<p class="links"><a id="back" href="#">Back to login</a></p>`,
      script: `
$('back').href = loginUrl;
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button'); btn.disabled = true;
  const r = await api('/api/auth/forgot-password', { email: $('email').value });
  show($('msg'), r.ok ? 'ok' : 'err', r.data.message || r.data.error || 'Something went wrong.');
  btn.disabled = false;
});`,
    }),

  '/reset-password': (nonce) =>
    shell({
      title: 'Reset password',
      nonce,
      body: `<h1>Choose a new password</h1>
<div id="msg" class="hidden"></div>
<form id="form" novalidate>
  <label for="pw">New password</label>
  <input id="pw" type="password" autocomplete="new-password" minlength="8" maxlength="128" required>
  <label for="pw2">Confirm new password</label>
  <input id="pw2" type="password" autocomplete="new-password" minlength="8" maxlength="128" required>
  <p class="muted">At least 8 characters, with a letter and a number.</p>
  <button type="submit">Reset password</button>
</form>
<div id="after"></div>
<p class="links hidden" id="again"><a href="/forgot-password">Request a new reset link</a></p>`,
      script: `
const token = tokenFromUrl();
const msg = $('msg'), form = $('form');
if (!token) { show(msg, 'err', 'This reset link is incomplete.'); form.classList.add('hidden'); $('again').classList.remove('hidden'); }
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('pw').value !== $('pw2').value) { show(msg, 'err', 'Passwords do not match.'); return; }
  const btn = form.querySelector('button'); btn.disabled = true;
  const r = await api('/api/auth/reset-password', { token, new_password: $('pw').value });
  if (r.ok) { show(msg, 'ok', r.data.message || 'Password updated.'); form.classList.add('hidden'); loginLink($('after')); return; }
  show(msg, 'err', r.data.error || 'Something went wrong.');
  if (r.status === 400 && r.data.code === 'INVALID_TOKEN') { form.classList.add('hidden'); $('again').classList.remove('hidden'); }
  btn.disabled = false;
});`,
    }),
};

// Returns { html, csp } for a page path, or null.
export function renderPage(path) {
  const build = PAGES[path];
  if (!build) return null;
  const nonce = randomBytes(16).toString('base64');
  return {
    html: build(nonce),
    csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}
