import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../auth/AuthContext.jsx';
import { CapBar, GradientDefs } from '../components/chartShapes.jsx';
import { ReplayControls } from '../components/ReplayControls.jsx';
import { RefreshStatus, SeverityBadge, SeverityIcon } from '../components/Severity.jsx';
import { ChartOrTable, ChartTooltip, ErrorState, Kpi, Loading, PageHead, Panel, Segmented } from '../components/ui.jsx';
import { fmtAgo, fmtInt, fmtMonth, fmtMonthShort, fmtNum, fmtPct, fmtSec } from '../format.js';
import { useApi, useInterval } from '../hooks/useApi.js';
import { useAlertStream } from '../realtime/AlertStream.jsx';
import { useRouteLoaded } from '../rum.js';
import { axis, C, grid, SEVERITY_COLOR } from '../theme/chart.js';

function LatencyDistribution({ threshold }) {
  const [scope, setScope] = useState('all');
  const [view, setView] = useState('chart');
  const { data, error } = useApi(`/api/dashboard/latency-distribution?scope=${scope}`);
  const bins = (data?.bins ?? []).map((b) => ({ ...b, mid: b.fromSec + 2.5 }));
  return (
    <Panel
      title="Load-latency distribution"
      sub={`Report-months per 5 s bin · threshold > ${threshold} s · never capped`}
      actions={
        <>
          <Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All snapshots' }, { value: 'latest', label: 'Latest' }]} />
          <Segmented label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
        </>
      }
    >
      <ErrorState error={error} />
      <div className="legend" style={{ marginBottom: 10 }}>
        {['OK', 'WARNING', 'HIGH', 'CRITICAL'].map((s) => (
          <span key={s}>
            <SeverityIcon severity={s} />
            {{ OK: '≤ 15 s', WARNING: '15–30 s', HIGH: '30–45 s', CRITICAL: '> 45 s' }[s]}
          </span>
        ))}
      </div>
      <ChartOrTable
        view={view}
        chart={
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={bins} margin={{ top: 18, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid {...grid} />
              <XAxis {...axis} type="number" dataKey="mid" domain={[0, 60]} ticks={[0, 10, 15, 20, 30, 40, 45, 50, 55, 60]} tickFormatter={(v) => `${v}s`} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                content={
                  <ChartTooltip
                    labelFormatter={(_l, p) => `${p[0].payload.fromSec}–${p[0].payload.toSec} s`}
                    rows={(p) => [{ color: SEVERITY_COLOR[p[0].payload.band], value: fmtInt(p[0].payload.count), name: `report-months · ${p[0].payload.band}` }]}
                  />
                }
              />
              <GradientDefs colors={Object.values(SEVERITY_COLOR)} />
              <Bar dataKey="count" barSize={26} isAnimationActive={false} shape={(p) => <CapBar {...p} color={SEVERITY_COLOR[p.payload.band]} />} />
              <ReferenceLine x={threshold} stroke={C.text2} strokeWidth={1.5} label={{ value: `${threshold} s alert threshold`, position: 'top', fill: C.text2, fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        }
        table={
          <table>
            <thead><tr><th>Bin</th><th>Band</th><th className="r">Report-months</th></tr></thead>
            <tbody>
              {bins.map((b) => (
                <tr key={b.fromSec}><td className="num">{b.fromSec}–{b.toSec} s</td><td><SeverityBadge severity={b.band} /></td><td className="num r">{b.count}</td></tr>
              ))}
            </tbody>
          </table>
        }
      />
    </Panel>
  );
}

function ReliabilityTrend() {
  const [view, setView] = useState('chart');
  const { data } = useApi('/api/dashboard/trend');
  const rows = data?.snapshots ?? [];
  const last = rows.at(-1);
  return (
    <Panel
      title="SLO breach and refresh failure by snapshot"
      sub="Share of the 100 reports in each monthly snapshot"
      actions={<Segmented label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
    >
      <div className="legend" style={{ marginBottom: 10 }}>
        <span><i className="line" style={{ background: C.accent }} />Latency &gt; 15 s {last && <b className="num" style={{ color: 'var(--text)' }}>{fmtPct(last.latency_breach_rate, 0)}</b>}</span>
        <span><i className="line" style={{ background: C.series2 }} />Refresh failed / timed out {last && <b className="num" style={{ color: 'var(--text)' }}>{fmtPct(last.refresh_failure_rate, 0)}</b>}</span>
      </div>
      <ChartOrTable
        view={view}
        chart={
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={rows} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid {...grid} />
              <XAxis {...axis} dataKey="period_month" tickFormatter={fmtMonthShort} interval={2} />
              <YAxis {...axis} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
              <Tooltip
                cursor={{ stroke: C.hairlineLit }}
                content={<ChartTooltip labelFormatter={(l, p) => `Snapshot ${p[0].payload.snapshot_seq} · ${fmtMonth(l)}`} rows={(p) => p.map((x) => ({ color: x.color, name: x.name, value: fmtPct(x.value) }))} />}
              />
              <Line type="monotone" dataKey="latency_breach_rate" name="latency > 15 s" stroke={C.accent} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: C.panel, strokeWidth: 2 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="refresh_failure_rate" name="refresh failed" stroke={C.series2} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: C.panel, strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        }
        table={
          <table>
            <thead><tr><th>Snapshot</th><th>Month</th><th className="r">Latency &gt; 15 s</th><th className="r">Refresh failed</th><th className="r">p50 latency</th><th className="r">Orphaned</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.snapshot_seq}><td className="num">{r.snapshot_seq}</td><td>{fmtMonth(r.period_month)}</td><td className="num r">{fmtPct(r.latency_breach_rate, 0)}</td><td className="num r">{fmtPct(r.refresh_failure_rate, 0)}</td><td className="num r">{fmtSec(r.p50_latency_sec)}</td><td className="num r">{r.orphaned}</td></tr>
              ))}
            </tbody>
          </table>
        }
      />
    </Panel>
  );
}

function PlatformHealth() {
  const { data, reload } = useApi('/api/health/system');
  useInterval(reload, 10_000);
  const { snapshots } = useAlertStream();
  const lastSnap = snapshots.at(-1);
  if (!data) return <Panel title="Platform self-health"><Loading /></Panel>;
  return (
    <Panel title="Platform self-health" sub="Command Center API, database and real-time channel · refreshes every 10 s">
      <div className="kv">
        <div><span className="label">Database</span><div className="v num">{data.database.status} · {fmtNum(data.database.latencyMs)} ms</div></div>
        <div><span className="label">API latency p95</span><div className="v num">{data.api.p95Ms == null ? '—' : `${fmtNum(data.api.p95Ms)} ms`}</div></div>
        <div><span className="label">WebSocket clients</span><div className="v num">{data.websocket.clients}</div></div>
        <div><span className="label">Telemetry · 5 min</span><div className="v num">{fmtInt(data.telemetry.eventsLast5m)} events</div></div>
        <div><span className="label">Last event</span><div className="v num">{fmtAgo(data.telemetry.lastEventAt)}</div></div>
        <div><span className="label">Uptime</span><div className="v num">{Math.floor(data.process.uptimeSec / 60)} min</div></div>
      </div>
      <div style={{ borderTop: '1px solid var(--rule)', margin: '20px 0 14px' }} />
      <span className="label">Telemetry replay · CSV snapshots streamed as live events</span>
      <div style={{ marginTop: 12 }}><ReplayControls /></div>
      {lastSnap && (
        <div className="note" style={{ marginTop: 14 }}>
          Snapshot <strong>{lastSnap.snapshotSeq}</strong> streamed: <strong>{lastSnap.latencyBreaches}</strong> of {lastSnap.reports} reports
          above 15 s, <strong>{lastSnap.refreshFailures}</strong> refresh failures, median load {fmtSec(lastSnap.medianLatencySec)}.
        </div>
      )}
    </Panel>
  );
}

export function Health() {
  const { can } = useAuth();
  const { counts } = useAlertStream();
  const { data: s, error } = useApi('/api/dashboard/summary');
  const { data: slow } = useApi('/api/dashboard/slowest?limit=8');
  useRouteLoaded(Boolean(s && slow), '/health');
  if (error) return <ErrorState error={error} />;
  if (!s) return <Loading what="system health" />;
  const L = s.latest;
  const A = s.allTime;

  return (
    <div className="stack">
      <PageHead title="System Health" actions={<span className="meta">Snapshot {L.snapshotSeq} · {fmtMonth(L.periodMonth)}</span>}>
        Report load latency, refresh reliability and ownership across the portal. Alerts fire when a dashboard load
        exceeds {s.thresholds.latencyAlertSec} s or an automated refresh fails.
      </PageHead>

      <div className="kpis">
        <Kpi
          wide
          label={`Reports breaching the ${s.thresholds.latencyAlertSec} s load SLO · latest snapshot`}
          value={L.latencyBreaching}
          unit={`of ${L.reports} reports`}
          foot={
            <>
              {fmtPct(A.latencyBreachRate)} of all {fmtInt(A.observations)} report-months exceed {s.thresholds.latencyAlertSec} s ·
              median {fmtSec(A.p50LatencySec)} · p95 {fmtSec(A.p95LatencySec)} · worst {fmtSec(A.maxLatencySec)} ({A.rowsAtMaxLatency} at the ceiling)
              <div style={{ marginTop: 6 }}><SeverityBadge severity="CRITICAL" label={`${L.latencyCritical} critical > 45 s in the latest snapshot`} /></div>
            </>
          }
        />
        <Kpi label="Refresh failures · latest" value={L.refreshFailing} unit="reports" foot={`${fmtPct(A.refreshFailureRate)} of all refreshes failed or timed out`} />
        <Kpi label="Orphaned reports" value={s.orphanedReports} unit="no owner" flag to={can('orphans:read') ? '/orphans' : undefined} toLabel="Review and reassign orphaned reports" foot={can('orphans:read') ? <Link to="/orphans">Review and reassign →</Link> : 'Owner missing in latest snapshot'} />
        <Kpi label="Median load · latest" value={fmtNum(L.p50LatencySec)} unit="s" foot={`p95 ${fmtSec(L.p95LatencySec)} · ${L.statusUnknown} refreshes with no status`} />
        <Kpi
          label="Live alerts"
          to="/alerts"
          toLabel="Open alerts"
          value={counts.total}
          unit="open"
          foot={
            <span className="row" style={{ gap: 12 }}>
              {['CRITICAL', 'HIGH', 'WARNING'].map((k) => (
                <span key={k} className="row num" style={{ gap: 5 }}><SeverityIcon severity={k} size={10} />{counts[k]}</span>
              ))}
            </span>
          }
        />
      </div>

      <div className="grid grid-2">
        <LatencyDistribution threshold={s.thresholds.latencyAlertSec} />
        <ReliabilityTrend />
      </div>

      <div className="grid grid-12">
        <div className="span-7">
          <Panel title="Slowest reports · latest snapshot" sub="Ordered by average load latency" flush>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Report</th><th>Owner</th><th className="r">Load</th><th>Band</th><th>Refresh</th></tr></thead>
                <tbody>
                  {(slow?.reports ?? []).map((r) => (
                    <tr key={r.report_id} className={r.is_orphaned ? 'flagged' : ''}>
                      <td><Link to={`/reports/${r.report_id}`} className="mono">{r.report_id}</Link><span className="sub-text">{r.report_name}</span></td>
                      <td className={r.owner_email ? '' : 'accent'}>{r.owner_email ?? 'Orphaned'}</td>
                      <td className="num r">{fmtSec(r.avg_load_time_sec)}</td>
                      <td><SeverityBadge severity={r.latency_band} /></td>
                      <td><RefreshStatus status={r.refresh_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="span-5">
          <PlatformHealth />
        </div>
      </div>
    </div>
  );
}
