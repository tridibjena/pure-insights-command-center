import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { qs } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { RefreshStatus, SeverityBadge } from '../components/Severity.jsx';
import { ErrorState, Loading, PageHead, Pagination, Panel, SortHeader } from '../components/ui.jsx';
import { fmtInt, fmtSec } from '../format.js';
import { useApi } from '../hooks/useApi.js';
import { useStreamEvent } from '../realtime/AlertStream.jsx';
import { useRouteLoaded } from '../rum.js';

export function Reports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ search: '', status: '', band: '', orphaned: '', sort: 'latency', order: 'desc', page: 1 });
  const set = (patch) => setF((prev) => ({ ...prev, page: 1, ...patch }));
  const { data, error, loading, reload } = useApi(`/api/reports${qs({ ...f, pageSize: 20 })}`);
  useStreamEvent(['alert.raised', 'alert.resolved', 'report.owner_changed'], reload);
  useRouteLoaded(Boolean(data), '/reports');
  const onSort = (field) => setF((p) => ({ ...p, sort: field, order: p.sort === field && p.order === 'desc' ? 'asc' : 'desc' }));

  return (
    <div className="stack">
      <PageHead title="Reports">
        {user.ownerScoped
          ? `Reports currently owned by ${user.ownerEmail}. Your access is row-scoped: other reports are not visible.`
          : `All ${data?.total ?? ''} portal reports with their latest snapshot, ${data?.reports[0]?.snapshots ?? ''}-snapshot history counts and live alerts.`}
      </PageHead>
      <div className="filters">
        <input className="input" placeholder="Search id or name…" value={f.search} onChange={(e) => set({ search: e.target.value })} aria-label="Search reports" style={{ width: 220 }} />
        <select className="select" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Refresh status">
          <option value="">Any refresh status</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="TIMED_OUT">Timed out</option>
          <option value="UNKNOWN">Unknown</option>
        </select>
        <select className="select" value={f.band} onChange={(e) => set({ band: e.target.value })} aria-label="Latency band">
          <option value="">Any latency</option>
          <option value="OK">OK ≤ 15 s</option>
          <option value="WARNING">Warning 15–30 s</option>
          <option value="HIGH">High 30–45 s</option>
          <option value="CRITICAL">Critical &gt; 45 s</option>
        </select>
        <select className="select" value={f.orphaned} onChange={(e) => set({ orphaned: e.target.value })} aria-label="Ownership">
          <option value="">Any ownership</option>
          <option value="true">Orphaned</option>
          <option value="false">Owned</option>
        </select>
      </div>
      <Panel flush>
        <ErrorState error={error} />
        {!data ? (
          <Loading what="reports" />
        ) : (
          <div className={`table-wrap ${loading ? 'stale' : ''}`}>
            <table>
              <thead>
                <tr>
                  <SortHeader label="Report" field="report_id" {...f} onSort={onSort} />
                  <th>Owner</th>
                  <SortHeader label="Load (latest)" field="latency" {...f} onSort={onSort} align="right" />
                  <th>Band</th>
                  <th>Refresh</th>
                  <SortHeader label="Views / mo" field="views" {...f} onSort={onSort} align="right" />
                  <SortHeader label="Breach snapshots" field="breaches" {...f} onSort={onSort} align="right" />
                  <SortHeader label="Failed refreshes" field="failures" {...f} onSort={onSort} align="right" />
                  <SortHeader label="Live alerts" field="alerts" {...f} onSort={onSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {data.reports.map((r) => (
                  <tr key={r.report_id} className={`clickable ${r.is_orphaned ? 'flagged' : ''}`} onClick={() => navigate(`/reports/${r.report_id}`)}>
                    <td><span className="mono">{r.report_id}</span><span className="sub-text">{r.report_name}</span></td>
                    <td className={r.owner_email ? '' : 'accent'}>{r.owner_email ?? 'Orphaned'}{r.has_owner_override && <span className="pill" style={{ marginLeft: 6 }}>reassigned</span>}</td>
                    <td className="num r">{fmtSec(r.avg_load_time_sec)}</td>
                    <td><SeverityBadge severity={r.latency_band} /></td>
                    <td><RefreshStatus status={r.refresh_status} /></td>
                    <td className="num r">{fmtInt(r.monthly_active_views)}</td>
                    <td className="num r">{r.breach_snapshots} / {r.snapshots}</td>
                    <td className="num r">{r.failure_snapshots}</td>
                    <td className="num r">{r.live_alerts ? <SeverityBadge severity={r.max_live_severity} label={String(r.live_alerts)} /> : <span className="dim">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.total === 0 && <div className="empty">No reports match these filters.</div>}
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF((p) => ({ ...p, page }))} />
          </div>
        )}
      </Panel>
    </div>
  );
}
