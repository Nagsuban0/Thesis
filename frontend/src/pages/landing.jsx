import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Alert, Logo, StatusBadge, StatusTrack, fmtDay } from '../components.jsx';

const STEPS = [
  { n: 1, title: 'Create an account', text: 'Sign up with your School ID so the registrar can find your requests.' },
  { n: 2, title: 'Request your documents', text: 'Add as many documents as you need in a single request.' },
  { n: 3, title: 'Track and collect', text: 'Search your School ID here any time and see where each document is.' },
];

function Result({ group }) {
  const { student, requests } = group;
  return (
    <section className="result-group">
      <header className="result-student">
        <div>
          <h3>{student.name}</h3>
          <p className="muted">
            {student.course || 'Student / alumni'}
            {student.student_no && ` · ID ${student.student_no}`}
          </p>
        </div>
        <span className="muted">
          {requests.length} request{requests.length === 1 ? '' : 's'}
        </span>
      </header>

      {requests.length === 0 && <p className="muted">No document requests yet.</p>}

      <div className="result-list">
        {requests.map((r) => (
          <article key={r.reference_no} className="result-card">
            <div className="result-top">
              <div>
                <strong>{r.document_name}</strong>
                <p className="muted">
                  {r.reference_no} · {r.copies} {r.copies === 1 ? 'copy' : 'copies'} ·{' '}
                  {r.delivery_method === 'delivery' ? 'Delivery' : 'Pick-up'}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <StatusTrack status={r.status} />
            <p className="muted result-date">
              Requested {fmtDay(r.created_at)} · Updated {fmtDay(r.updated_at)}
            </p>
            {r.status === 'ready' && (
              <p className="callout">
                {r.delivery_method === 'delivery'
                  ? 'Your document is ready and will be delivered.'
                  : 'Your document is ready. You may pick it up at the registrar’s office.'}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function Landing() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const search = async (e) => {
    e.preventDefault();
    const term = q.trim();
    setError('');
    if (term.length < 3) {
      setResults(null);
      setError('Please enter at least 3 characters.');
      return;
    }
    setLoading(true);
    try {
      const d = await api.get(`/public/track?q=${encodeURIComponent(term)}`);
      setResults(d.results);
      setSearched(term);
    } catch (err) {
      setResults(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing">
      <header className="landing-nav">
        <Logo size={38} />
        <nav className="landing-actions">
          <Link to="/login" className="btn btn-light">
            Log in
          </Link>
          <Link to="/register" className="btn">
            Register
          </Link>
        </nav>
      </header>

      <section className="hero">
        <span className="hero-blob b1" />
        <span className="hero-blob b2" />
        <div className="hero-inner">
          <p className="eyebrow">Registrar document requests</p>
          <h1>
            Track your <span>document request</span>
          </h1>
          <p className="hero-sub">
            Enter your School ID or last name to see if your request is pending, approved, processing, ready or released.
          </p>

          <form className="search" onSubmit={search} role="search">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="School ID (e.g. 2019-0456) or Last Name"
              aria-label="School ID or last name"
              maxLength={40}
              autoComplete="off"
            />
            <button className="btn" disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
          <p className="hero-hint">Tip: searching by School ID gives the most accurate result.</p>
        </div>
      </section>

      <main className="landing-body">
        {error && <Alert>{error}</Alert>}

        {results && (
          <div className="results" aria-live="polite">
            {results.length === 0 ? (
              <div className="card empty">
                <h3>No matching student found</h3>
                <p className="muted">
                  We couldn’t find “{searched}”. Check the spelling or School ID, or{' '}
                  <Link to="/register">create an account</Link> to make your first request.
                </p>
              </div>
            ) : (
              <>
                {results.length > 1 && (
                  <p className="muted">
                    {results.length} students match “{searched}”. Use your School ID to narrow it down.
                  </p>
                )}
                {results.map((g, i) => (
                  <Result key={i} group={g} />
                ))}
              </>
            )}
          </div>
        )}

        <section className="how">
          <h2>How it works</h2>
          <div className="how-grid">
            {STEPS.map((s) => (
              <div key={s.n} className="how-card">
                <span className="how-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p className="muted">{s.text}</p>
              </div>
            ))}
          </div>
          <div className="center cta">
            <Link to="/register" className="btn">
              Request a document
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <Logo size={26} />
        <small>For your privacy, only first names and initials are shown in public results.</small>
      </footer>
    </div>
  );
}
