import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  Alert,
  Modal,
  StatCard,
  StatusBadge,
  StatusTrack,
  fmtDate,
  fmtDay,
} from '../components.jsx';

const ACTIVE = ['pending', 'approved', 'processing', 'ready'];
const MAX_ITEMS = 10;

const PURPOSES = [
  'Employment',
  'Transfer to another school',
  'Scholarship',
  'Further studies',
  'Board exam / licensure',
  'Personal records',
  'Other',
];

function useRequests() {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    api
      .get('/requests')
      .then((d) => setRequests(d.requests))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);
  return { requests, error, reload };
}

function RequestCard({ r, onOpen }) {
  return (
    <button type="button" className="req-card" onClick={() => onOpen(r)}>
      <div className="result-top">
        <div>
          <strong>{r.document_name}</strong>
          <p className="muted">
            {r.reference_no} · {r.copies} {r.copies === 1 ? 'copy' : 'copies'}
          </p>
        </div>
        <StatusBadge status={r.status} />
      </div>
      <StatusTrack status={r.status} />
      <p className="muted result-date">Requested {fmtDay(r.created_at)}</p>
    </button>
  );
}

function RequestDetail({ id, onClose, onChanged }) {
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/requests/${id}`)
      .then((d) => setRequest(d.request))
      .catch((e) => setError(e.message));
  }, [id]);

  const cancel = async () => {
    if (!window.confirm('Cancel this request?')) return;
    setBusy(true);
    setError('');
    try {
      const d = await api.post(`/requests/${id}/cancel`);
      setRequest(d.request);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={request ? request.document_name : 'Request'} onClose={onClose}>
      <Alert>{error}</Alert>
      {!request && !error && <p className="muted">Loading…</p>}
      {request && (
        <>
          <StatusTrack status={request.status} />
          <dl className="details">
            <dt>Reference</dt>
            <dd>{request.reference_no}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={request.status} />
            </dd>
            <dt>Copies</dt>
            <dd>{request.copies}</dd>
            <dt>Purpose</dt>
            <dd>{request.purpose}</dd>
            <dt>Release</dt>
            <dd>{request.delivery_method === 'delivery' ? 'Delivery' : 'Pick-up at the registrar'}</dd>
            {request.notes && (
              <>
                <dt>Notes</dt>
                <dd>{request.notes}</dd>
              </>
            )}
            {request.admin_remarks && (
              <>
                <dt>Registrar remarks</dt>
                <dd>{request.admin_remarks}</dd>
              </>
            )}
          </dl>

          <h4>History</h4>
          <ul className="timeline">
            {request.history.map((h, i) => (
              <li key={i}>
                <StatusBadge status={h.status} /> <small className="muted">{fmtDate(h.created_at)}</small>
                {h.remarks && <div className="muted">{h.remarks}</div>}
              </li>
            ))}
          </ul>

          {request.status === 'pending' && (
            <button className="btn btn-danger btn-block" onClick={cancel} disabled={busy}>
              {busy ? 'Cancelling…' : 'Cancel request'}
            </button>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------- dashboard ----------
export function ClientDashboard() {
  const { user } = useAuth();
  const { requests, error, reload } = useRequests();
  const [openId, setOpenId] = useState(null);

  const counts = useMemo(() => {
    const c = { total: 0, pending: 0, working: 0, ready: 0, released: 0 };
    for (const r of requests || []) {
      c.total += 1;
      if (r.status === 'pending') c.pending += 1;
      if (r.status === 'approved' || r.status === 'processing') c.working += 1;
      if (r.status === 'ready') c.ready += 1;
      if (r.status === 'released') c.released += 1;
    }
    return c;
  }, [requests]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Hello, {user.full_name.split(' ')[0]}</h2>
          <p className="muted">
            {user.student_no ? `School ID ${user.student_no}` : 'Add your School ID in your profile so the registrar can find you.'}
          </p>
        </div>
        <Link to="/client/new" className="btn">
          + Request documents
        </Link>
      </div>

      <Alert>{error}</Alert>

      {counts.ready > 0 && (
        <div className="callout">
          {counts.ready === 1 ? '1 document is' : `${counts.ready} documents are`} ready. Check{' '}
          <Link to="/client/requests">My requests</Link> for pick-up or delivery details.
        </div>
      )}

      <div className="stats">
        <StatCard label="Total requests" value={counts.total} />
        <StatCard label="Pending" value={counts.pending} tone="warn" />
        <StatCard label="In progress" value={counts.working} tone="info" />
        <StatCard label="Ready" value={counts.ready} tone="ok" />
        <StatCard label="Released" value={counts.released} />
      </div>

      <div className="section-head">
        <h3>Recent requests</h3>
        <Link to="/client/requests">View all</Link>
      </div>

      {!requests && !error && <p className="muted">Loading…</p>}
      {requests && requests.length === 0 && (
        <div className="card empty">
          <h3>No requests yet</h3>
          <p className="muted">Request one or more documents in a single step.</p>
          <Link to="/client/new" className="btn">
            Request documents
          </Link>
        </div>
      )}
      <div className="req-list">
        {(requests || []).slice(0, 4).map((r) => (
          <RequestCard key={r.id} r={r} onOpen={(x) => setOpenId(x.id)} />
        ))}
      </div>

      {openId && <RequestDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

// ---------- request several documents at once ----------
let rowKey = 0;
const newRow = (document_type_id = '') => ({ key: ++rowKey, document_type_id: String(document_type_id), copies: 1 });

export function RequestDocument() {
  const [docs, setDocs] = useState(null);
  const [active, setActive] = useState(new Set());
  const [rows, setRows] = useState(() => [newRow()]);
  const [purposeChoice, setPurposeChoice] = useState(PURPOSES[0]);
  const [purposeOther, setPurposeOther] = useState('');
  const [delivery, setDelivery] = useState('pickup');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/document-types'), api.get('/requests')])
      .then(([d, r]) => {
        setDocs(d.document_types);
        setActive(new Set(r.requests.filter((x) => ACTIVE.includes(x.status)).map((x) => x.document_type_id)));
      })
      .catch((e) => setError(e.message));
  }, []);

  const chosen = rows.map((r) => r.document_type_id).filter(Boolean);
  const available = (docs || []).filter((d) => !active.has(d.id));
  const unused = available.filter((d) => !chosen.includes(String(d.id)));

  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const addRow = (docId = '') => {
    setRows((rs) => {
      if (rs.length >= MAX_ITEMS) return rs;
      const empty = rs.find((r) => !r.document_type_id);
      if (docId && empty) return rs.map((r) => (r === empty ? { ...r, document_type_id: String(docId) } : r));
      return [...rs, newRow(docId)];
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (rows.some((r) => !r.document_type_id)) return setError('Choose a document for every row, or remove the empty row.');
    const purpose = purposeChoice === 'Other' ? purposeOther.trim() : purposeChoice;
    if (!purpose) return setError('Please tell us the purpose of your request.');

    setBusy(true);
    try {
      const d = await api.post('/requests/batch', {
        purpose,
        delivery_method: delivery,
        notes,
        items: rows.map((r) => ({ document_type_id: Number(r.document_type_id), copies: Number(r.copies) || 1 })),
      });
      setDone(d.requests);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <div className="page-head">
          <h2>Request submitted</h2>
        </div>
        <div className="card">
          <Alert type="success">
            {done.length === 1 ? 'Your request was' : `${done.length} requests were`} sent to the registrar.
          </Alert>
          <ul className="plain">
            {done.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.document_name}</strong>
                  <br />
                  <small className="muted">
                    {r.reference_no} · {r.copies} {r.copies === 1 ? 'copy' : 'copies'}
                  </small>
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
          <div className="actions-bar" style={{ marginTop: 16 }}>
            <Link to="/client/requests" className="btn">
              View my requests
            </Link>
            <button
              className="btn btn-ghost-dark"
              onClick={() => {
                setDone(null);
                setRows([newRow()]);
                setNotes('');
                api.get('/requests').then((r) =>
                  setActive(new Set(r.requests.filter((x) => ACTIVE.includes(x.status)).map((x) => x.document_type_id)))
                );
              }}
            >
              Request more
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Request documents</h2>
          <p className="muted">Add everything you need and send it as one request.</p>
        </div>
      </div>

      <Alert>{error}</Alert>
      {!docs && !error && <p className="muted">Loading…</p>}

      {docs && (
        <form className="form" onSubmit={submit}>
          <div className="card">
            <h3>Documents</h3>

            {rows.map((row, i) => {
              const options = available.filter(
                (d) => String(d.id) === row.document_type_id || !chosen.includes(String(d.id))
              );
              const selected = docs.find((d) => String(d.id) === row.document_type_id);
              return (
                <div className="item-row" key={row.key}>
                  <span className="item-n">{i + 1}</span>
                  <label className="item-doc">
                    Document
                    <select
                      value={row.document_type_id}
                      onChange={(e) => update(row.key, { document_type_id: e.target.value })}
                      required
                    >
                      <option value="">Select a document…</option>
                      {options.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    {selected && (
                      <small className="muted">
                        {selected.description} Usually ready in {selected.processing_days} day
                        {selected.processing_days === 1 ? '' : 's'}.
                      </small>
                    )}
                  </label>
                  <label className="item-copies">
                    Copies
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={row.copies}
                      onChange={(e) => update(row.key, { copies: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-btn item-remove"
                    onClick={() => remove(row.key)}
                    disabled={rows.length === 1}
                    aria-label={`Remove document ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              className="btn btn-outline btn-block"
              onClick={() => addRow()}
              disabled={rows.length >= MAX_ITEMS || unused.length === 0}
            >
              Add another document
            </button>

            {unused.length > 0 && rows.length < MAX_ITEMS && (
              <div className="chips">
                <small className="muted">Quick add:</small>
                {unused.map((d) => (
                  <button type="button" key={d.id} className="chip" onClick={() => addRow(d.id)}>
                    + {d.name}
                  </button>
                ))}
              </div>
            )}

            {active.size > 0 && (
              <p className="hint">
                Documents you already have an active request for are hidden until that request is released or cancelled.
              </p>
            )}
          </div>

          <div className="card">
            <h3>Details</h3>
            <label>
              Purpose
              <select value={purposeChoice} onChange={(e) => setPurposeChoice(e.target.value)}>
                {PURPOSES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            {purposeChoice === 'Other' && (
              <label>
                Please specify
                <input value={purposeOther} onChange={(e) => setPurposeOther(e.target.value)} maxLength={200} required />
              </label>
            )}
            <label>
              How will you get your documents?
              <select value={delivery} onChange={(e) => setDelivery(e.target.value)}>
                <option value="pickup">Pick-up at the registrar</option>
                <option value="delivery">Delivery</option>
              </select>
            </label>
            <label>
              Notes (optional)
              <textarea rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </label>
          </div>

          <button className="btn btn-block btn-lg" disabled={busy}>
            {busy ? 'Submitting…' : `Submit ${rows.length} document${rows.length === 1 ? '' : 's'}`}
          </button>
        </form>
      )}
    </>
  );
}

// ---------- my requests ----------
const FILTERS = [
  ['all', 'All'],
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['processing', 'Processing'],
  ['ready', 'Ready'],
  ['released', 'Released'],
  ['closed', 'Rejected / Cancelled'],
];

export function MyRequests() {
  const { requests, error, reload } = useRequests();
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);

  const matches = (r, f) =>
    f === 'all' || r.status === f || (f === 'closed' && (r.status === 'rejected' || r.status === 'cancelled'));
  const shown = (requests || []).filter((r) => matches(r, filter));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>My requests</h2>
          <p className="muted">Tap a request to see its full history.</p>
        </div>
        <Link to="/client/new" className="btn">
          + Request documents
        </Link>
      </div>

      <Alert>{error}</Alert>

      <div className="chips chips-scroll" role="tablist">
        {FILTERS.map(([key, label]) => {
          const n = (requests || []).filter((r) => matches(r, key)).length;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              className={`chip ${filter === key ? 'chip-on' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label} <span className="chip-n">{n}</span>
            </button>
          );
        })}
      </div>

      {!requests && !error && <p className="muted">Loading…</p>}
      {requests && shown.length === 0 && (
        <div className="card empty">
          <p className="muted">Nothing here yet.</p>
        </div>
      )}
      <div className="req-list">
        {shown.map((r) => (
          <RequestCard key={r.id} r={r} onOpen={(x) => setOpenId(x.id)} />
        ))}
      </div>

      {openId && <RequestDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

// ---------- profile ----------
export function Profile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    full_name: user.full_name || '',
    phone: user.phone || '',
    address: user.address || '',
    student_no: user.student_no || '',
    course: user.course || '',
  });
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(false);

  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwMsg, setPwMsg] = useState({ type: '', text: '' });
  const [pwBusy, setPwBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ type: '', text: '' });
    try {
      const d = await api.patch('/auth/me', form);
      setUser(d.user);
      setMsg({ type: 'success', text: 'Profile saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwBusy(true);
    setPwMsg({ type: '', text: '' });
    try {
      await api.post('/auth/change-password', pw);
      setPw({ current_password: '', new_password: '' });
      setPwMsg({ type: 'success', text: 'Password updated.' });
    } catch (err) {
      setPwMsg({ type: 'error', text: err.message });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h2>Profile</h2>
      </div>

      <form className="card form" onSubmit={save}>
        <h3>Your details</h3>
        <Alert type={msg.type || 'error'}>{msg.text}</Alert>
        <label>
          Full name
          <input value={form.full_name} onChange={set('full_name')} maxLength={100} required />
        </label>
        <label>
          Email
          <input value={user.email} disabled />
        </label>
        <div className="row">
          <label>
            School ID
            <input value={form.student_no} onChange={set('student_no')} maxLength={20} placeholder="e.g. 2019-0456" />
          </label>
          <label>
            Course
            <input value={form.course} onChange={set('course')} maxLength={100} />
          </label>
        </div>
        <p className="hint">Your School ID is how the registrar and the front-page search find your requests.</p>
        <div className="row">
          <label>
            Phone
            <input value={form.phone} onChange={set('phone')} maxLength={30} inputMode="tel" />
          </label>
          <label>
            Address
            <input value={form.address} onChange={set('address')} maxLength={200} />
          </label>
        </div>
        <button className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <form className="card form" onSubmit={changePassword}>
        <h3>Change password</h3>
        <Alert type={pwMsg.type || 'error'}>{pwMsg.text}</Alert>
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={pw.current_password}
            onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={pw.new_password}
            onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))}
            minLength={8}
            required
          />
          <small className="muted">At least 8 characters, with a letter and a number.</small>
        </label>
        <button className="btn" disabled={pwBusy}>
          {pwBusy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </>
  );
}
