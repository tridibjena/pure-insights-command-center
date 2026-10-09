import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { navFor } from '../auth/navigation.js';
import { useAlertStream } from '../realtime/AlertStream.jsx';
import { useRouteTimer } from '../rum.js';
import { BellIcon, BellOffIcon } from './icons.jsx';
import { Toasts } from './Toasts.jsx';

const ROLE_LABEL = {
  ADMIN: 'Administrator',
  PLATFORM_ENGINEER: 'Platform Engineer',
  FINOPS_ANALYST: 'FinOps Analyst',
  REPORT_OWNER: 'Report Owner',
};

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="#b87333" strokeWidth="1.6" />
        <path d="M8 4.4V8l2.6 1.6" fill="none" stroke="#f5f5f5" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const initials = (name) =>
  name
    .replace(/\(.*\)/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="user-chip" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} title={user.email}>
        <span className="avatar">{initials(user.displayName)}</span>
        <span className="who">
          <b>{user.displayName}</b>
          <span>{ROLE_LABEL[user.role]}</span>
        </span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div>
            <div style={{ color: 'var(--text)' }}>{user.displayName}</div>
            <div className="dim">{user.email}</div>
            <div className="muted" style={{ marginTop: 4 }}>{ROLE_LABEL[user.role]}</div>
            {user.ownerScoped && <div className="accent" style={{ marginTop: 4 }}>Scoped to {user.ownerEmail}</div>}
          </div>
          <button type="button" className="btn" role="menuitem" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { counts, muted, setMuted } = useAlertStream();
  const navigate = useNavigate();
  useRouteTimer();

  return (
    <div className="app">
      <header className="topnav">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">Pure Insights</div>
            <div className="brand-sub">Command Center</div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {navFor(user).map((i) => (
            <NavLink key={i.to} to={i.to}>
              {i.label}
              {i.to === '/alerts' && counts.total > 0 && <span className="count">{counts.total}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="top-actions">
          {user.ownerScoped && <span className="chip accent">Scoped to {user.ownerEmail}</span>}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            aria-label={muted ? 'Notifications muted — unmute' : 'Mute notifications'}
            title={muted ? 'Notifications muted — click to unmute' : 'Notifications on — click to mute'}
          >
            {muted ? <BellOffIcon /> : <BellIcon />}
            {!muted && counts.total > 0 && <span className="badge-dot" />}
          </button>
          <UserMenu
            user={user}
            onSignOut={async () => {
              await logout();
              navigate('/login');
            }}
          />
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <Toasts />
    </div>
  );
}
