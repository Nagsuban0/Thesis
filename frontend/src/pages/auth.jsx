import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Logo } from '../components.jsx';

const home = (user) => (user.role === 'admin' ? '/admin' : user.role === 'registrar' ? '/registrar' : '/client');

// Shared frame for every auth screen: gradient background, back button, centered card.
function AuthShell({ children, wide, back = '/', backLabel = 'Back to home' }) {
  return (
    <div className="auth-page">
      <Link to={back} className="auth-back">
        <span aria-hidden>←</span> {backLabel}
      </Link>
      <div className={`card auth-card ${wide ? 'wide' : ''}`}>
        <div className="auth-logo">
          <Logo size={40} />
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete, minLength, required = true }) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
      />
      <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}>
        {show ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}

// Resend the verification email, with a short cooldown so it can't be spammed.
function useResend(email) {
  const [cooldown, setCooldown] = useState(0);
  const [msg, setMsg] = useState({ type: '', text: '' });
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const resend = async () => {
    setMsg({ type: '', text: '' });
    try {
      await api.post('/auth/resend-verification', { email });
      setMsg({ type: 'success', text: 'A new verification email was sent.' });
      setCooldown(60);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  };
  return { resend, cooldown, msg };
}

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const { resend, cooldown, msg } = useResend(form.email);

  if (user) return <Navigate to={home(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setBusy(true);
    try {
      const u = await login(form.email, form.password);
      navigate(home(u), { replace: true });
    } catch (err) {
      if (err.code === 'email_not_verified') setUnverified(true);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="muted auth-sub">Log in to request or manage documents.</p>
      {location.state?.notice && <Alert type="success">{location.state.notice}</Alert>}
      <Alert>{error}</Alert>
      {unverified && (
        <Alert>
          Please verify your email first. We sent a link to <strong>{form.email}</strong>.{' '}
          <button type="button" className="btn-link" onClick={resend} disabled={cooldown > 0}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
          </button>
        </Alert>
      )}
      <Alert type={msg.type || 'error'}>{msg.text}</Alert>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Password
          <PasswordInput autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        <div className="auth-links">
          <span />
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <button className="btn btn-lg" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="muted center" style={{ marginTop: 18 }}>
        No account yet? <Link to="/register">Register</Link>
      </p>
    </AuthShell>
  );
}

export function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', student_no: '', course: '', phone: '', address: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={home(user)} replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form);
      navigate('/check-email', { replace: true, state: { email: form.email } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell wide>
      <h1>Create an account</h1>
      <p className="muted auth-sub">We’ll email you a link to verify your account.</p>
      <Alert>{error}</Alert>
      <form onSubmit={submit}>
        <label>
          Full name
          <input required autoComplete="name" value={form.full_name} onChange={set('full_name')} />
        </label>
        <label>
          Email
          <input type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </label>
        <div className="row">
          <label>
            Student / ID number
            <input value={form.student_no} onChange={set('student_no')} />
          </label>
          <label>
            Course / Program
            <input value={form.course} onChange={set('course')} placeholder="e.g. BSIT" />
          </label>
        </div>
        <div className="row">
          <label>
            Phone
            <input value={form.phone} onChange={set('phone')} inputMode="tel" />
          </label>
          <label>
            Address
            <input value={form.address} onChange={set('address')} />
          </label>
        </div>
        <label>
          Password (min. 8 characters, with a letter and a number)
          <PasswordInput autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} />
        </label>
        <button className="btn btn-lg" disabled={busy}>
          {busy ? 'Creating…' : 'Register'}
        </button>
      </form>
      <p className="muted center" style={{ marginTop: 18 }}>
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </AuthShell>
  );
}

// Shown right after registering: "go check your inbox".
export function CheckEmail() {
  const { state } = useLocation();
  const email = state?.email;
  const { resend, cooldown, msg } = useResend(email);
  if (!email) return <Navigate to="/login" replace />;
  return (
    <AuthShell back="/login" backLabel="Back to log in">
      <div className="auth-icon">✉️</div>
      <h1>Check your email</h1>
      <p className="muted auth-sub">
        We sent a verification link to <strong>{email}</strong>. Click it to activate your account, then log in.
      </p>
      <Alert type={msg.type || 'error'}>{msg.text}</Alert>
      <p className="muted center">
        Didn’t get it? Check your spam folder or{' '}
        <button type="button" className="btn-link" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `resend in ${cooldown}s` : 'resend the email'}
        </button>
        .
      </p>
      <Link to="/login" className="btn btn-light btn-block" style={{ marginTop: 16 }}>
        Go to log in
      </Link>
    </AuthShell>
  );
}

// Landing page of the link inside the verification email: /verify-email?token=...
export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState(token ? 'loading' : 'error');
  const [error, setError] = useState(token ? '' : 'This verification link is missing its token.');
  const ran = useRef(false); // StrictMode runs effects twice; tokens are single-use

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((e) => {
        setError(e.message);
        setState('error');
      });
  }, [token]);

  return (
    <AuthShell back="/login" backLabel="Back to log in">
      {state === 'loading' && (
        <>
          <div className="spinner" />
          <h1>Verifying…</h1>
        </>
      )}
      {state === 'ok' && (
        <>
          <div className="auth-icon">✅</div>
          <h1>Email verified</h1>
          <p className="muted auth-sub">Your account is active. You can log in now.</p>
          <Link to="/login" className="btn btn-lg">
            Log in
          </Link>
        </>
      )}
      {state === 'error' && (
        <>
          <div className="auth-icon">⚠️</div>
          <h1>Link not valid</h1>
          <Alert>{error}</Alert>
          <p className="muted center">The link may have expired. Log in to request a new verification email.</p>
          <Link to="/login" className="btn btn-light btn-block" style={{ marginTop: 12 }}>
            Go to log in
          </Link>
        </>
      )}
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell back="/login" backLabel="Back to log in">
      {sent ? (
        <>
          <div className="auth-icon">✉️</div>
          <h1>Check your email</h1>
          <p className="muted auth-sub">
            If an account exists for <strong>{email}</strong>, we sent a link to reset your password. It expires in 1 hour.
          </p>
          <Link to="/login" className="btn btn-light btn-block">
            Back to log in
          </Link>
        </>
      ) : (
        <>
          <h1>Forgot password?</h1>
          <p className="muted auth-sub">Enter your email and we’ll send you a reset link.</p>
          <Alert>{error}</Alert>
          <form onSubmit={submit}>
            <label>
              Email
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn btn-lg" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

// Landing page of the reset email: /reset-password?token=...
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);


const submit = async (e) => {
  e.preventDefault();
  setError('');

  if (pw.password.length < 8 || pw.password.length > 128) {
    setError('Password must be 8–128 characters long.');
    return;
  }

  if (!/[A-Za-z]/.test(pw.password) || !/[0-9]/.test(pw.password)) {
    setError('Password must contain a letter and a number.');
    return;
  }

  if (pw.password !== pw.confirm) {
    setError('Passwords do not match.');
    return;
  }

  setBusy(true);

  try {
    await api.post('/auth/reset-password', {
      token,
      new_password: pw.password,
    });

    navigate('/login', {
      replace: true,
      state: { notice: 'Password updated. You can log in now.' },
    });
  } catch (err) {
    setError(err.message || 'Unable to reset password. Please try again.');
  } finally {
    setBusy(false);
  }
};


  return (
    <AuthShell back="/login" backLabel="Back to log in">
      <h1>Set a new password</h1>
      {!token ? (
        <>
          <Alert>This reset link is missing its token.</Alert>
          <Link to="/forgot-password" className="btn btn-light btn-block">
            Request a new link
          </Link>
        </>
      ) : (
        <>
          <p className="muted auth-sub">Choose a strong password you haven’t used before.</p>
          <Alert>{error}</Alert>
          <form onSubmit={submit}>
            <label>
              New password (min. 8 characters, with a letter and a number)
              <PasswordInput autoComplete="new-password" minLength={8} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
            </label>
            <label>
              Confirm password
              <PasswordInput autoComplete="new-password" minLength={8} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </label>
            <button className="btn btn-lg" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
