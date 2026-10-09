import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { homePathFor } from '../auth/navigation.js';
import { StatusCluster } from '../components/StatusCluster.jsx';

export function Forbidden({ permission }) {
  const { user } = useAuth();
  return (
    <>
    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><StatusCluster /></div>
    <div className="card" style={{ maxWidth: 620, margin: '24px 0' }}>
      <div className="stack tight" style={{ gap: 14 }}>
        <span className="label">403 · Access denied</span>
        <h1 style={{ fontSize: 30 }}>This page needs a permission your role doesn’t have</h1>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          Your role <span className="mono">{user?.role}</span> does not include{' '}
          <span className="mono accent">{permission}</span>. The API enforces the same rule, so the data is not
          reachable directly either. Ask an administrator if you need access.
        </p>
        <div>
          <Link className="btn" to={homePathFor(user)}>Back to your dashboard</Link>
        </div>
      </div>
    </div>
    </>
  );
}

export function NotFound() {
  return (
    <div className="card" style={{ maxWidth: 620, margin: '48px 0' }}>
      <div className="stack tight" style={{ gap: 14 }}>
        <span className="label">404</span>
        <h1>Nothing here</h1>
        <Link className="btn" to="/">Go home</Link>
      </div>
    </div>
  );
}
