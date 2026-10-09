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
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" fill="none" stroke="#b87333" strokeWidth="1.8" />
        <path d="M8 4.2V8l2.8 1.7" fill="none" stroke="#f3f3f3" strokeWidth="1.8" strokeLinecap="round" />
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
              <div className="nav-section label bare">{section}</div>
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
        <div className="sidebar-foot">
          <div style={{ fontSize: 13, color: 'var(--text)' }}>{user.displayName}</div>
          <div className="muted" style={{ fontSize: 12, margin: '2px 0 10px' }}>{user.email}</div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="pill">{ROLE_LABEL[user.role]}</span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 14 }}>
            {['CRITICAL', 'HIGH', 'WARNING'].map((s) => (
              <span key={s} className="row num" style={{ gap: 6, fontSize: 12.5 }} title={`${counts[s]} live ${s.toLowerCase()} alerts`}>
                <SeverityIcon severity={s} />
                {counts[s]} <span className="muted">{s.toLowerCase()}</span>
              </span>
            ))}
            {user.ownerScoped && <span className="pill warn">Scoped to {user.ownerEmail}</span>}
          </div>
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn ghost sm" onClick={() => setMuted(!muted)} aria-pressed={muted}>
              {muted ? 'Notifications muted' : 'Notifications on'}
            </button>
            <span className="conn" aria-live="polite">
              <span className="dot" style={{ background: conn.color }} />
              WebSocket · {conn.label}
            </span>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  );
}
