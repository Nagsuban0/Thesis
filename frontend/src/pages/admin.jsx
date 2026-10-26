import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Alert, Modal, StatCard, StatusBadge, STATUS_LABELS, fmtDate, peso } from '../components.jsx';

// Mirrors the rules enforced by the API.
const TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['processing', 'rejected'],
  processing: ['ready', 'rejected'],
  ready: ['released'],
  released: [],
  rejected: [],
  cancelled: [],
};
// Registrar handles every step; admin can override and do the same.
const STAFF = ['admin', 'registrar'];
const STATUS_ROLES = {
  approved: STAFF,
  rejected: STAFF,
  processing: STAFF,
  ready: STAFF,
  released: STAFF,
};
const ACTIONS = {
  approved: { label: 'Approve', cls: 'btn-ok' },
  rejected: { label: 'Reject', cls: 'btn-danger' },
  processing: { label: 'Start processing', cls: '' },
  ready: { label: 'Mark ready for release', cls: 'btn-ok' },
  released: { label: 'Mark released', cls: '' },
};

function StaffDashboard({ role }) {
  const base = role === 'admin' ? '/admin' : '/registrar';
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/stats').then(setStats).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="page-head">
        <h2>{role === 'admin' ? 'Admin dashboard' : 'Registrar dashboard'}</h2>
      </div>
      <Alert>{error}</Alert>
      {stats && (
        <>
          {stats.by_status.pending > 0 && (
            <div className="callout">
              <strong>{stats.by_status.pending}</strong> new request(s) waiting for review.{' '}
              <Link to={`${base}/requests?status=pending`}>Review now →</Link>
            </div>
          )}
          <div className="stats">
            <StatCard label="New (awaiting review)" value={stats.by_status.pending} tone="warn" />
            <StatCard label="Approved (to process)" value={stats.by_status.approved} tone="info" />
            <StatCard label="Processing" value={stats.by_status.processing} tone="info" />
            <StatCard label="Ready for release" value={stats.by_status.ready} tone="ok" />
            <StatCard label="Released" value={stats.by_status.released} />
            <StatCard label="Total requests" value={stats.total} />
            {role === 'admin' && <StatCard label="Registered students" value={stats.clients} />}
            {role === 'admin' && <StatCard label="Fees collected (released)" value={peso(stats.revenue)} tone="ok" />}
          </div>
          <div className="grid-2">
            <div className="card">
              <h3>Latest requests</h3>
              {stats.recent.length === 0 && <p className="muted">No requests yet.</p>}
              <ul className="plain">
                {stats.recent.map((r) => (
                  <li key={r.id}>
                    <div>
                      <strong>{r.document_name}</strong>
                      <div className="muted">
                        {r.client_name} · {r.reference_no}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h3>Most requested documents</h3>
              {stats.top_documents.length === 0 && <p className="muted">No data yet.</p>}
              <ul className="plain">
                {stats.top_documents.map((d) => (
                  <li key={d.name}>
                    <span>{d.name}</span>
                    <strong>{d.count}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export const AdminDashboard = () => <StaffDashboard role="admin" />;
export const RegistrarDashboard = () => <StaffDashboard role="registrar" />;

function ManageRequest({ id, role, onClose, onSaved }) {
  const [req, setReq] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/requests/${id}`)
      .then((d) => {
        setReq(d.request);
        setRemarks(d.request.admin_remarks || '');
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const allowed = req ? TRANSITIONS[req.status].filter((s) => STATUS_ROLES[s].includes(role)) : [];

  const act = async (status) => {
    setError('');
    if (status === 'rejected' && !remarks.trim()) {
      setError('Please write the reason for rejecting in the remarks box.');
      return;
    }
    if (status === 'rejected' && !window.confirm('Reject this request?')) return;
    setBusy(true);
    try {
      const d = await api.patch(`/admin/requests/${id}`, { status, admin_remarks: remarks });
      setReq(d.request);
      setRemarks(d.request.admin_remarks || '');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={req ? `Request ${req.reference_no}` : 'Request'} onClose={onClose}>
      <Alert>{error}</Alert>
      {req && (
        <>
          <dl className="details">
            <dt>Student</dt>
            <dd>
              {req.client_name}
              <div className="muted">
                {req.client_email}
                {req.client_student_no && ` · ID ${req.client_student_no}`}
                {req.client_course && ` · ${req.client_course}`}
              </div>
            </dd>
            <dt>Document</dt>
            <dd>{req.document_name}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={req.status} />
            </dd>
            <dt>Purpose</dt>
            <dd>{req.purpose}</dd>
            <dt>Copies / Fee</dt>
            <dd>
              {req.copies} · {peso(req.total_fee)}
            </dd>
            <dt>Release method</dt>
            <dd>{req.delivery_method === 'pickup' ? 'Pick-up' : 'Delivery'}</dd>
            {req.notes && (
              <>
                <dt>Student notes</dt>
                <dd>{req.notes}</dd>
              </>
            )}
            <dt>Submitted</dt>
            <dd>{fmtDate(req.created_at)}</dd>
          </dl>

          {allowed.length > 0 ? (
            <div className="form">
              <label>
                Remarks {allowed.includes('rejected') && '(required when rejecting; the student will see it)'}
                <textarea rows="3" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </label>
              <div className="actions-bar">
                {allowed.map((s) => (
                  <button key={s} className={`btn ${ACTIONS[s].cls}`} disabled={busy} onClick={() => act(s)}>
                    {ACTIONS[s].label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">This request is {STATUS_LABELS[req.status].toLowerCase()} — no further action needed.</p>
          )}

          <h4>History</h4>
          <ul className="timeline">
            {req.history.map((h, i) => (
              <li key={i}>
                <StatusBadge status={h.status} /> <span className="muted">{fmtDate(h.created_at)}</span>
                {h.changed_by_name && <span className="muted"> · {h.changed_by_name}</span>}
                {h.remarks && <div>{h.remarks}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function StaffRequests({ role }) {
  const [params] = useSearchParams();
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState(params.get('status') || '');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    api
      .get(`/admin/requests?${p}`)
      .then((d) => setRequests(d.requests))
      .catch((e) => setError(e.message));
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <div className="page-head">
        <h2>{role === 'admin' ? 'All requests' : 'Student requests'}</h2>
        <div className="toolbar">
          <input placeholder="Search name, ID, reference…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Alert>{error}</Alert>
      <div className="card">
        {requests.length === 0 ? (
          <p className="muted">No requests found.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Student</th>
                  <th>Document</th>
                  <th>Fee</th>
                  <th>Status</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                    <td>{r.reference_no}</td>
                    <td>
                      {r.client_name}
                      <div className="muted">
                        {r.client_student_no || r.client_email}
                        {r.client_course && ` · ${r.client_course}`}
                      </div>
                    </td>
                    <td>
                      {r.document_name} × {r.copies}
                    </td>
                    <td>{peso(r.total_fee)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openId && <ManageRequest id={openId} role={role} onClose={() => setOpenId(null)} onSaved={load} />}
    </>
  );
}

export const AdminRequests = () => <StaffRequests role="admin" />;
export const RegistrarRequests = () => <StaffRequests role="registrar" />;

const emptyType = { name: '', description: '', fee: 0, processing_days: 3, is_active: true };

function DocTypeForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({ ...emptyType, ...initial, is_active: initial ? !!initial.is_active : true });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const body = {
      name: form.name,
      description: form.description,
      fee: Number(form.fee),
      processing_days: Number(form.processing_days),
      is_active: form.is_active,
    };
    try {
      if (initial) await api.patch(`/admin/document-types/${initial.id}`, body);
      else await api.post('/admin/document-types', body);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={initial ? 'Edit document' : 'New document'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Alert>{error}</Alert>
        <label>
          Name
          <input required value={form.name} onChange={set('name')} />
        </label>
        <label>
          Description
          <textarea rows="2" value={form.description || ''} onChange={set('description')} />
        </label>
        <div className="row">
          <label>
            Fee (₱)
            <input type="number" min="0" step="0.01" required value={form.fee} onChange={set('fee')} />
          </label>
          <label>
            Processing days
            <input type="number" min="0" required value={form.processing_days} onChange={set('processing_days')} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Available to students
        </label>
        <button className="btn">Save</button>
      </form>
    </Modal>
  );
}

export function AdminDocumentTypes() {
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | type object

  const load = useCallback(() => {
    api.get('/admin/document-types').then((d) => setTypes(d.document_types)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const remove = async (t) => {
    if (!window.confirm(`Remove "${t.name}"? If it already has requests, it will be hidden instead.`)) return;
    try {
      await api.del(`/admin/document-types/${t.id}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <h2>Documents offered</h2>
        <button className="btn" onClick={() => setEditing('new')}>
          + Add document
        </button>
      </div>
      <Alert>{error}</Alert>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Fee</th>
                <th>Days</th>
                <th>Visibility</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <div className="muted">{t.description}</div>
                  </td>
                  <td>{peso(t.fee)}</td>
                  <td>{t.processing_days}</td>
                  <td>{t.is_active ? <span className="badge badge-ready">Active</span> : <span className="badge badge-cancelled">Hidden</span>}</td>
                  <td className="actions">
                    <button className="btn btn-small btn-ghost" onClick={() => setEditing(t)}>
                      Edit
                    </button>
                    <button className="btn btn-small btn-danger" onClick={() => remove(t)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && (
        <DocTypeForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </>
  );
}

function AccountsTable({ users, onToggle, onReset }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Contact</th>
            <th>Requests</th>
            <th>Joined</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                <strong>{u.full_name}</strong>
                {!u.is_active && <span className="badge badge-rejected"> Deactivated</span>}
                {(u.student_no || u.course) && (
                  <div className="muted">
                    {u.student_no}
                    {u.course && ` · ${u.course}`}
                  </div>
                )}
              </td>
              <td>
                {u.email}
                <div className="muted">{u.phone}</div>
              </td>
              <td>{u.request_count}</td>
              <td>{fmtDate(u.created_at)}</td>
              <td className="actions">
                {onReset && (
                  <button className="btn btn-small btn-ghost" onClick={() => onReset(u)}>
                    Reset password
                  </button>
                )}
                <button className={`btn btn-small ${u.is_active ? 'btn-danger' : 'btn-ok'}`} onClick={() => onToggle(u)}>
                  {u.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useUsers(role) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api
      .get('/admin/users')
      .then((d) => setUsers(d.users.filter((u) => u.role === role)))
      .catch((e) => setError(e.message));
  }, [role]);
  useEffect(load, [load]);
  const toggle = async (u) => {
    setError('');
    try {
      await api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active });
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  return { users, error, setError, load, toggle };
}

export function AdminStudents() {
  const { users, error, toggle } = useUsers('client');
  return (
    <>
      <div className="page-head">
        <h2>Students / alumni</h2>
      </div>
      <Alert>{error}</Alert>
      <div className="card">
        {users.length === 0 ? <p className="muted">No registered students yet.</p> : <AccountsTable users={users} onToggle={toggle} />}
      </div>
    </>
  );
}

function RegistrarForm({ onClose, onSaved }) {
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/admin/registrars', form);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title="New registrar account" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Alert>{error}</Alert>
        <label>
          Full name
          <input required value={form.full_name} onChange={set('full_name')} />
        </label>
        <label>
          Email (used to log in)
          <input type="email" required value={form.email} onChange={set('email')} />
        </label>
        <label>
          Phone
          <input value={form.phone} onChange={set('phone')} />
        </label>
        <label>
          Temporary password (min. 6 characters)
          <input required minLength={6} value={form.password} onChange={set('password')} />
        </label>
        <button className="btn">Create registrar</button>
      </form>
    </Modal>
  );
}

export function AdminRegistrars() {
  const { users, error, setError, load, toggle } = useUsers('registrar');
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');

  const reset = async (u) => {
    const pw = window.prompt(`New password for ${u.full_name} (min. 6 characters):`);
    if (!pw) return;
    setError('');
    setMsg('');
    try {
      await api.patch(`/admin/users/${u.id}`, { new_password: pw });
      setMsg(`Password for ${u.full_name} was changed.`);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Registrar accounts</h2>
          <p className="muted">Registrars process approved requests. You control who can log in.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>
          + Add registrar
        </button>
      </div>
      <Alert>{error}</Alert>
      <Alert type="success">{msg}</Alert>
      <div className="card">
        {users.length === 0 ? (
          <p className="muted">No registrar accounts yet.</p>
        ) : (
          <AccountsTable users={users} onToggle={toggle} onReset={reset} />
        )}
      </div>
      {creating && <RegistrarForm onClose={() => setCreating(false)} onSaved={load} />}
    </>
  );
}
