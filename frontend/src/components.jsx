import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

export const STATUS_LABELS = {
  pending: 'Pending approval',
  approved: 'Approved',
  processing: 'Processing',
  ready: 'Ready',
  released: 'Released',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

// The normal path of a request, in order.
export const STATUS_STEPS = ['pending', 'approved', 'processing', 'ready', 'released'];

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

// Fees are switched off, but other pages still import this helper.
export const peso = (n) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n || 0);

export const fmtDate = (s) =>
  s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

export const fmtDay = (s) =>
  s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '-';

// Swap /public/logo.svg for your own logo file; nothing else needs to change.
export function Logo({ size = 36, label = 'DocRequest', sub }) {
  return (
    <span className="logo">
      <img src="/logo.svg" width={size} height={size} alt="" />
      <span className="logo-text">
        <strong>{label}</strong>
        {sub && <small>{sub}</small>}
      </span>
    </span>
  );
}

// Shows how far along a request is: Pending > Approved > Processing > Ready > Released.
export function StatusTrack({ status }) {
  if (status === 'rejected' || status === 'cancelled') {
    return (
      <p className={`track-end track-${status}`}>
        {status === 'rejected' ? 'This request was rejected.' : 'This request was cancelled.'}
      </p>
    );
  }
  const current = STATUS_STEPS.indexOf(status);
  return (
    <ol className="track" aria-label="Request progress">
      {STATUS_STEPS.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'current' : ''}>
          <span className="track-dot" />
          <span className="track-label">{STATUS_LABELS[s].replace(' approval', '')}</span>
        </li>
      ))}
    </ol>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Alert({ type = 'error', children }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api
      .get('/notifications')
      .then((d) => {
        setItems(d.notifications);
        setUnread(d.unread_count);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await api.post('/notifications/read');
        setUnread(0);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="bell-wrap">
      <button className="btn btn-ghost bell-btn" onClick={toggle} aria-expanded={open}>
        Notifications
        {unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          {items.length === 0 && <p className="muted">No notifications yet.</p>}
          {items.map((n) => (
            <div key={n.id} className={`bell-item ${n.is_read ? '' : 'unread'}`}>
              <div>{n.message}</div>
              <small>{fmtDate(n.created_at)}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout({ title, links }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu whenever the page changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="menu-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <span />
          <span />
          <span />
        </button>
        <Logo size={30} sub={title} />
      </header>

      {menuOpen && <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />}

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <Logo sub={title} />
        </div>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {user.role === 'client' && <NotificationBell />}
          <div className="who">
            <strong>{user.full_name}</strong>
            <small>{user.email}</small>
          </div>
          <button className="btn btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
