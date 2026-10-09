import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { navFor } from '../auth/navigation.js';
import { useAlertStream } from '../realtime/AlertStream.jsx';
import { useRouteTimer } from '../rum.js';
import { SEVERITY_COLOR } from '../theme/chart.js';
import { SeverityIcon } from './Severity.jsx';
import { Toasts } from './Toasts.jsx';

const CONN = {
  open: { color: SEVERITY_COLOR.OK, label: 'Live' },
  connecting: { color: SEVERITY_COLOR.WARNING, label: 'Connecting' },
  reconnecting: { color: SEVERITY_COLOR.HIGH, label: 'Reconnecting' },
  offline: { color: '#6f7681', label: 'Offline' },
};

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
        <path d="M8 4.4V8l2.6 1.6" fill="none" stroke="#f3f3f3" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { counts, connection, muted, setMuted } = useAlertStream();
  const navigate = useNavigate();
  useRouteTimer();
  const items = navFor(user);
  const sections = [...new Set(items.map((i) => i.section))];
  const conn = CONN[connection];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">Pure Insights</div>
            <div className="brand-sub">Command Center</div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {sections.map((section) => (
            <div key={section}>
              <div className="nav-section label">{section}</div>
              {items
                .filter((i) => i.section === section)
                .map((i) => (
                  <NavLink key={i.to} to={i.to}>
                    {i.label}
                    {i.to === '/alerts' && counts.total > 0 && <span className="count">{counts.total}</span>}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>

        <div className="side-block" aria-live="polite">
          <span className="label">Live alerts</span>
          <div className="row" style={{ gap: 12 }}>
            {['CRITICAL', 'HIGH', 'WARNING'].map((s) => (
              <span key={s} className="row num" style={{ gap: 5 }} title={`${counts[s]} live ${s.toLowerCase()} alerts`}>
                <SeverityIcon severity={s} size={10} />
                {counts[s]}
              </span>
            ))}
          </div>
          <span className="conn">
            <span className="dot" style={{ background: conn.color }} />
            WebSocket · {conn.label}
          </span>
          <button type="button" className="linklike" onClick={() => setMuted(!muted)} aria-pressed={muted}>
            {muted ? 'Notifications muted — unmute' : 'Mute notifications'}
          </button>
        </div>

        <div className="side-block">
          <div>
            <div style={{ color: 'var(--text)' }}>{user.displayName}</div>
            <div className="dim">{user.email}</div>
            <div className="muted" style={{ marginTop: 4 }}>{ROLE_LABEL[user.role]}</div>
            {user.ownerScoped && <div className="accent" style={{ marginTop: 4 }}>Scoped to {user.ownerEmail}</div>}
          </div>
          <button
            type="button"
            className="linklike"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <main className="content">
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  );
}
