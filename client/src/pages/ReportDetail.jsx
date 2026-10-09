import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../auth/AuthContext.jsx';
import { RefreshStatus, refreshSeverity, SeverityBadge } from '../components/Severity.jsx';
import { ChartOrTable, ChartTooltip, ErrorState, Kpi, Loading, PageHead, Panel, Segmented } from '../components/ui.jsx';
import { fmtInt, fmtMonth, fmtMonthShort, fmtNum, fmtSec, fmtTime, fmtUsd } from '../format.js';
import { useApi } from '../hooks/useApi.js';
import { useStreamEvent } from '../realtime/AlertStream.jsx';
import { useRouteLoaded } from '../rum.js';
import { axis, C, grid, SEVERITY_COLOR } from '../theme/chart.js';

export function ReportDetail() {
  const { reportId } = useParams();
  const { can } = useAuth();
  const [view, setView] = useState('chart');
  const { data, error, reload } = useApi(`/api/reports/${reportId}`);
  useStreamEvent(['alert.raised', 'alert.escalated', 'alert.resolved', 'alert.acknowledged', 'report.owner_changed'], (m) => {
    if (m.data?.report_id === reportId) reload();
  });
  useRouteLoaded(Boolean(data), '/reports/:id');
  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading what="report" />;
  const { report, history, ownerTimeline, alerts, dataQualityIssues, cost } = data;
  const latest = history.at(-1);
  const breaches = history.filter((h) => h.latency_band !== 'OK').length;

  return (
    <div className="stack">
      <PageHead
        title={`${report.report_name}`}
        actions={<Link className="btn ghost" to="/reports">← All reports</Link>}
      >
        <span className="mono">{report.report_id}</span> · owner{' '}
        {report.owner_email ? <span className="mono">{report.owner_email}</span> : <span className="accent">none (orphaned)</span>}
        {report.has_owner_override && ' (reassigned by an administrator)'} · {report.distinct_owner_count} different owners across 20 snapshots
      </PageHead>

      <div className="kpis">
        <Kpi label="Load latency · latest" value={fmtNum(latest.avg_load_time_sec)} unit="s"><SeverityBadge severity={latest.latency_band} /></Kpi>
        <Kpi label="Refresh · latest" value={<RefreshStatus status={latest.refresh_status} />} foot={`${history.filter((h) => h.refresh_status === 'FAILED' || h.refresh_status === 'TIMED_OUT').length} failed refreshes in 20 snapshots`} />
        <Kpi label="Snapshots above 15 s" value={breaches} unit="/ 20" foot={`Worst ${fmtSec(Math.max(...history.map((h) => h.avg_load_time_sec ?? 0)))}`} />
        <Kpi label="Active views · latest" value={fmtInt(latest.monthly_active_views)} foot={`Peak ${latest.concurrent_user_peak} concurrent users`} />
        {cost && <Kpi label="Fully loaded cost / view" value={fmtUsd(cost.fully_loaded_cost_per_view_usd)} foot={`Snowflake ${fmtUsd(cost.snowflake_cost_per_view_usd)} + AWS ${fmtUsd(cost.aws_cost_per_view_usd)}`} flag />}
      </div>

      <Panel
        title="Load latency across 20 snapshots"
        sub="Average dashboard load time per monthly snapshot; the line marks the 15 s alert threshold"
        actions={<Segmented label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
      >
        <ChartOrTable
          view={view}
          chart={
            <>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={history} margin={{ top: 16, right: 16, left: -10, bottom: 0 }}>
                  <CartesianGrid {...grid} />
                  <XAxis {...axis} dataKey="period_month" tickFormatter={fmtMonthShort} interval={1} />
                  <YAxis {...axis} domain={[0, 60]} ticks={[0, 15, 30, 45, 60]} tickFormatter={(v) => `${v}s`} />
                  <ReferenceLine y={15} stroke={C.text2} strokeWidth={1.5} label={{ value: '15 s threshold', position: 'insideTopRight', fill: C.text2, fontSize: 11 }} />
                  <Tooltip
                    cursor={{ stroke: C.hairlineLit }}
                    content={<ChartTooltip labelFormatter={(l, p) => `Snapshot ${p[0].payload.snapshot_seq} · ${fmtMonth(l)}`} rows={(p) => [{ color: C.accent, name: `${p[0].payload.latency_band} · refresh ${p[0].payload.refresh_status}`, value: fmtSec(p[0].value) }]} />}
                  />
                  <Line
                    type="linear"
                    dataKey="avg_load_time_sec"
                    stroke={C.accent}
                    strokeWidth={2}
                    isAnimationActive={false}
                    dot={(p) => <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={SEVERITY_COLOR[p.payload.latency_band]} stroke={C.panel} strokeWidth={2} />}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 14 }}>
                <span className="label">Refresh outcome per snapshot</span>
                <div className="strip" style={{ marginTop: 8 }}>
                  {history.map((h) => (
                    <span key={h.snapshot_seq} title={`Snapshot ${h.snapshot_seq} · ${h.refresh_status}`} style={{ background: SEVERITY_COLOR[refreshSeverity(h.refresh_status)] }} />
                  ))}
                </div>
                <div className="legend" style={{ marginTop: 8 }}>
                  <span><i style={{ background: SEVERITY_COLOR.OK }} />Success</span>
                  <span><i style={{ background: SEVERITY_COLOR.WARNING }} />Unknown</span>
                  <span><i style={{ background: SEVERITY_COLOR.HIGH }} />Timed out</span>
                  <span><i style={{ background: SEVERITY_COLOR.CRITICAL }} />Failed</span>
                </div>
              </div>
            </>
          }
          table={
            <table>
              <thead><tr><th>Snapshot</th><th>Month</th><th>Owner (raw)</th><th className="r">Load</th><th>Band</th><th>Refresh</th><th className="r">Views</th><th className="r">Credits</th><th className="r">AWS $</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.snapshot_seq} className={h.is_orphaned || h.is_negative_credits ? 'flagged' : ''}>
                    <td className="num">{h.snapshot_seq}</td><td>{fmtMonth(h.period_month)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{h.owner_raw}</td>
                    <td className="num r">{fmtSec(h.avg_load_time_sec)}</td><td><SeverityBadge severity={h.latency_band} /></td>
                    <td><RefreshStatus status={h.refresh_status} /></td><td className="num r">{fmtInt(h.monthly_active_views)}</td>
                    <td className="num r">{h.is_negative_credits ? <span className="accent">{h.credits_raw} → quarantined</span> : fmtNum(h.credits_clean, 2)}</td>
                    <td className="num r">{fmtUsd(h.aws_hosting_cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </Panel>

      <div className="grid grid-2">
        <Panel title="Ownership timeline" sub="Consecutive snapshots with the same owner are grouped">
          <ul className="timeline">
            {ownerTimeline.map((t) => (
              <li key={t.fromSnapshot}>
                <span className="num muted">{t.fromSnapshot === t.toSnapshot ? `#${t.fromSnapshot}` : `#${t.fromSnapshot}–${t.toSnapshot}`}</span>
                <span>{t.ownerEmail ? <span className="mono">{t.ownerEmail}</span> : <span className="accent">Orphaned · raw value “{t.rawValue}”</span>}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <div className="stack">
          <Panel title="Alerts for this report" sub="Live and recent incidents" flush>
            {alerts.length === 0 ? (
              <div className="empty">No alerts yet — start the telemetry replay to stream this report’s snapshots.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Severity</th><th>Alert</th><th>Status</th><th className="r">Seen</th><th>Updated</th></tr></thead>
                  <tbody>
                    {alerts.map((a) => (
                      <tr key={a.alert_id}><td><SeverityBadge severity={a.severity} /></td><td>{a.title}</td><td className="mono" style={{ fontSize: 11 }}>{a.status}</td><td className="num r">{a.occurrence_count}×</td><td className="num muted">{fmtTime(a.updated_at)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {can('dq:read') && (
            <Panel title="Data-quality findings" sub="Defects detected in this report’s source rows" flush>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Snapshot</th><th>Rule</th><th>Raw value</th><th>Action</th></tr></thead>
                  <tbody>
                    {dataQualityIssues.filter((i) => i.rule_code !== 'DQ_LATENCY_SPIKE').map((i) => (
                      <tr key={`${i.rule_code}-${i.snapshot_seq}`}><td className="num">#{i.snapshot_seq}</td><td>{i.title}</td><td className="mono" style={{ fontSize: 12 }}>{i.raw_value}</td><td className="mono dim" style={{ fontSize: 11 }}>{i.action_taken}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
