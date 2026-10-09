import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { homePathFor } from '../auth/navigation.js';
import { BrandMark } from '../components/Layout.jsx';

const DEMO = [
  { email: 'admin@pureinsights.local', role: 'Administrator' },
  { email: 'sre@pureinsights.local', role: 'Platform Engineer' },
  { email: 'finops@pureinsights.local', role: 'FinOps Analyst' },
  { email: 'user_7@company.com', role: 'Report Owner' },
];

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePathFor(user)} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      navigate(location.state?.from ?? homePathFor(u), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card stack">
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark />
          <div>
            <div className="brand-name">Pure Insights Command Center</div>
            <div className="brand-sub">Platform operational analytics</div>
          </div>
        </div>
        <form className="panel" onSubmit={submit}>
          <div className="panel-body stack" style={{ padding: 22 }}>
            <div>
              <h1 style={{ fontSize: 18 }}>Sign in</h1>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                Local account · session kept in a secure httpOnly cookie.
              </p>
            </div>
            <label className="field">
              <span className="label">Email</span>
              <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Password</span>
              <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <div className="note" role="alert" style={{ borderColor: 'var(--sev-critical)' }}>{error}</div>}
            <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
        <div className="panel">
          <div className="panel-body stack" style={{ gap: 10 }}>
            <span className="label">Demo accounts (one per role)</span>
            <div className="demo-users">
              {DEMO.map((d) => (
                <button key={d.email} type="button" onClick={() => setEmail(d.email)}>
                  <span className="mono">{d.email}</span>
                  <span className="muted">{d.role}</span>
                </button>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              Password: the <span className="mono">SEED_DEMO_PASSWORD</span> value in <span className="mono">.env</span> (see README).
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
