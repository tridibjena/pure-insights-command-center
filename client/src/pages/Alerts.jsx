import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ReplayControls } from '../components/ReplayControls.jsx';
import { SeverityBadge } from '../components/Severity.jsx';
import { Empty, Kpi, Modal, PageHead, Panel, Segmented } from '../components/ui.jsx';
import { fmtAgo, fmtSec, fmtTime } from '../format.js';
import { useApi } from '../hooks/useApi.js';
import { sortAlerts } from '../realtime/alertsReducer.js';
import { useAlertStream } from '../realtime/AlertStream.jsx';
import { useRouteLoaded } from '../rum.js';

const RULE_LABEL = {
  LATENCY_SLO_BREACH: 'Latency > 15 s',
  REFRESH_FAILURE: 'Refresh failure',
  TELEMETRY_GAP: 'Telemetry gap',
  RUM_SLOW_LOAD: 'Slow page (RUM)',
};

function AlertDetail({ alertId, onClose }) {
  const { can } = useAuth();
  const { dispatch } = useAlertStream();
  const { data, reload } = useApi(`/api/alerts/${alertId}`);
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState(null);
  const a = data?.alert;

  async function act(path, body) {
    setError(null);
    try {
      const r = await api(`/api/alerts/${alertId}/${path}`, { method: 'POST', body });
      dispatch({ type: 'upsert', alert: r.alert });
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal title={a ? a.title : 'Alert'} onClose={onClose}>
      {!a ? (
        <Empty>Loading…</Empty>
      ) : (
        <>
          <div className="row">
            <SeverityBadge severity={a.severity} />
            <span className="pill">{a.status}</span>
            <span className="pill">{RULE_LABEL[a.rule_code]}</span>
            {a.peak_severity !== a.severity && <span className="muted" style={{ fontSize: 12 }}>peak {a.peak_severity}</span>}
          </div>
          <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>{a.message}</p>
          <div className="kv">
            <div><span className="label">Metric</span><div className="v num">{a.metric_value == null ? '—' : fmtSec(a.metric_value)}</div></div>
            <div><span className="label">Threshold</span><div className="v num">{a.threshold == null ? '—' : `> ${a.threshold} s`}</div></div>
            <div><span className="label">Occurrences</span><div className="v num">{a.occurrence_count}</div></div>
            <div><span className="label">First seen</span><div className="v num" style={{ fontSize: 12.5 }}>{fmtTime(a.first_seen_at)}</div></div>
          </div>
          <div>
            <span className="label">Lifecycle</span>
            <ul className="timeline" style={{ marginTop: 6, maxHeight: 200, overflow: 'auto' }}>
              {data.events.map((e) => (
                <li key={e.alert_event_id}>
                  <span className="num muted" style={{ fontSize: 11.5 }}>{fmtTime(e.at)}</span>
                  <span><span className="mono" style={{ fontSize: 11.5 }}>{e.event_type}</span>{e.severity && <> · {e.severity}</>}{e.metric_value != null && <> · {fmtSec(e.metric_value)}</>} <span className="muted">by {e.actor}</span></span>
                </li>
              ))}
            </ul>
          </div>
          {can('alerts:ack') && a.status !== 'RESOLVED' && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                {a.status === 'OPEN' && <button type="button" className="btn primary" onClick={() => act('acknowledge', {})}>Acknowledge</button>}
              </div>
              <div className="row">
                <input className="input" style={{ flex: 1 }} placeholder="Resolution note" value={resolution} onChange={(e) => setResolution(e.target.value)} />
                <button type="button" className="btn" disabled={resolution.trim().length < 3} onClick={() => act('resolve', { resolution })}>Resolve</button>
              </div>
            </div>
          )}
          {a.resolution && <div className="note">Resolved by <strong>{a.resolved_by}</strong>: {a.resolution}</div>}
          {error && <div className="note">{error}</div>}
        </>
      )}
    </Modal>
  );
}

export function Alerts() {
  const { can, user } = useAuth();
  const { state, counts, connection } = useAlertStream();
  const [status, setStatus] = useState('live');
  const [severity, setSeverity] = useState('');
  const [rule, setRule] = useState('');
  const [selected, setSelected] = useState(null);
  useRouteLoaded(connection === 'open', '/alerts');

  const alerts = useMemo(() => {
    let list = Object.values(state.byId);
    if (status === 'live') list = list.filter((a) => a.status !== 'RESOLVED');
    else if (status !== 'all') list = list.filter((a) => a.status === status);
    if (severity) list = list.filter((a) => a.severity === severity);
    if (rule) list = list.filter((a) => a.rule_code === rule);
    return sortAlerts(list).slice(0, 300);
  }, [state, status, severity, rule]);

  const all = Object.values(state.byId);
  const resolvedCount = all.filter((a) => a.status === 'RESOLVED').length;
  // Repeat breaches folded into an existing incident instead of creating a new alert
  const folded = all.reduce((n, a) => n + a.occurrence_count - 1, 0);

  return (
    <div className="stack">
      <PageHead title="Alerts">
        Real-time operational notifications over WebSocket. One incident per report and rule: repeats update it, a higher
        severity escalates it, and recovery resolves it automatically.
        {user.ownerScoped && ' You only receive alerts for reports you own.'}
      </PageHead>
      <div className="grid grid-12">
        <div className="span-8 kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          <Kpi label="Critical" value={counts.CRITICAL} foot="Load > 45 s or refresh FAILED" />
          <Kpi label="High" value={counts.HIGH} foot="Load 30–45 s or refresh TIMED_OUT" />
          <Kpi label="Warning" value={counts.WARNING} foot="Load 15–30 s or status UNKNOWN" />
          <Kpi label="Resolved" value={resolvedCount} foot={`${folded} repeat breaches folded into existing incidents`} />
        </div>
        {can('health:read') && (
          <div className="span-4">
            <Panel title="Telemetry replay" sub="Streams the 20 CSV snapshots through the live alert pipeline">
              <ReplayControls />
            </Panel>
          </div>
        )}
      </div>
      <div className="filters">
        <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'live', label: 'Live' }, { value: 'ACKNOWLEDGED', label: 'Acknowledged' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'all', label: 'All' }]} />
        <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">Any severity</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="WARNING">Warning</option>
        </select>
        <select className="select" value={rule} onChange={(e) => setRule(e.target.value)} aria-label="Rule">
          <option value="">Any rule</option>
          {Object.entries(RULE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <Panel flush>
        {alerts.length === 0 ? (
          <Empty>{connection === 'open' ? 'No alerts match. Start the telemetry replay to stream live events.' : 'Connecting to the alert stream…'}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Severity</th><th>Alert</th><th>Rule</th><th>Report</th><th className="r">Metric</th><th className="r">Seen</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.alert_id} className="clickable" onClick={() => setSelected(a.alert_id)}>
                    <td><SeverityBadge severity={a.severity} /></td>
                    <td>{a.title}</td>
                    <td className="muted">{RULE_LABEL[a.rule_code]}</td>
                    <td>{a.report_id ? <Link to={`/reports/${a.report_id}`} className="mono" onClick={(e) => e.stopPropagation()}>{a.report_id}</Link> : '—'}</td>
                    <td className="num r">{a.metric_value == null ? '—' : fmtSec(a.metric_value)}</td>
                    <td className="num r">{a.occurrence_count}×</td>
                    <td className="mono" style={{ fontSize: 11 }}>{a.status}</td>
                    <td className="num muted">{fmtAgo(a.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {selected && <AlertDetail alertId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
