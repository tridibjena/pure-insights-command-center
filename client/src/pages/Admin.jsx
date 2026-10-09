import { useAuth } from '../auth/AuthContext.jsx';
import { ReplayControls } from '../components/ReplayControls.jsx';
import { ErrorState, Loading, PageHead, Panel } from '../components/ui.jsx';
import { fmtAgo, fmtTime } from '../format.js';
import { useApi } from '../hooks/useApi.js';
import { useRouteLoaded } from '../rum.js';

export function Admin() {
  const { can } = useAuth();
  const { data: users, error } = useApi('/api/admin/users');
  const { data: rbac } = useApi('/api/admin/rbac');
  const { data: audit } = useApi('/api/admin/audit?limit=40', { enabled: can('audit:read') });
  useRouteLoaded(Boolean(users && rbac), '/admin');
  if (error) return <ErrorState error={error} />;
  if (!users || !rbac) return <Loading what="administration" />;
  const roles = rbac.roles.filter((r) => r.role !== 'SERVICE');
  const perms = Object.keys(rbac.permissions);

  return (
    <div className="stack">
      <PageHead title="Administration">
        Accounts, the role → permission matrix the API enforces, telemetry replay control and the audit trail.
      </PageHead>
      <div className="grid grid-12">
        <div className="span-8">
          <Panel title="Role-based access control" sub="Enforced server-side on every REST route and WebSocket message · ◐ = row-scoped to owned reports" flush>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Permission</th>{roles.map((r) => <th key={r.role} className="r">{r.role.replace('_', ' ')}</th>)}<th className="r">SERVICE</th></tr>
                </thead>
                <tbody>
                  {perms.map((p) => (
                    <tr key={p}>
                      <td><span className="mono" style={{ fontSize: 12 }}>{p}</span> <span className="muted" style={{ fontSize: 12 }}>· {rbac.permissions[p]}</span></td>
                      {roles.map((r) => (
                        <td key={r.role} className="r" aria-label={r.permissions.includes(p) ? 'granted' : 'not granted'}>
                          {r.permissions.includes(p) ? <span className={r.ownerScoped ? 'accent' : 'pos'}>{r.ownerScoped ? '◐' : '●'}</span> : <span className="dim">·</span>}
                        </td>
                      ))}
                      <td className="r">{p === 'telemetry:ingest' ? <span className="pos">●</span> : <span className="dim">·</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="span-4 stack">
          <Panel title="Telemetry replay" sub="Streams the 2,000 CSV observations, snapshot by snapshot, through the live ingest → alert → WebSocket path">
            <ReplayControls />
          </Panel>
          <Panel title="Accounts" flush>
            <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Role</th><th>Last sign-in</th></tr></thead>
              <tbody>
                {users.users.map((u) => (
                  <tr key={u.user_id}>
                    <td><div>{u.display_name}</div><div className="mono muted" style={{ fontSize: 11.5 }}>{u.email}</div></td>
                    <td className="mono" style={{ fontSize: 10.5 }}>{u.role.replace('_', ' ')}</td>
                    <td className="num muted" style={{ fontSize: 12 }}>{fmtAgo(u.last_login_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Panel>
        </div>
      </div>
      {audit && (
        <Panel title="Audit log" sub="Sign-ins, denied requests and privileged actions (latest 40)" flush>
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th></tr></thead>
              <tbody>
                {audit.entries.map((e) => (
                  <tr key={e.audit_id} className={e.outcome !== 'SUCCESS' ? 'flagged' : ''}>
                    <td className="num muted" style={{ fontSize: 12 }}>{fmtTime(e.at)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{e.actor_email ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{e.action}</td>
                    <td className="mono dim" style={{ fontSize: 12 }}>{e.target ?? ''}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{e.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
