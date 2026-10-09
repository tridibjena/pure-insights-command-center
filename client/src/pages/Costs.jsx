import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { CapBar, GradientDefs } from '../components/chartShapes.jsx';
import { SeverityBadge } from '../components/Severity.jsx';
import { ChartOrTable, ChartTooltip, ErrorState, Kpi, Loading, PageHead, Panel, Segmented } from '../components/ui.jsx';
import { fmtCompact, fmtInt, fmtMonth, fmtMonthShort, fmtNum, fmtPct, fmtUsd, fmtUsdCompact } from '../format.js';
import { useApi } from '../hooks/useApi.js';
import { useRouteLoaded } from '../rum.js';
import { axis, C, grid } from '../theme/chart.js';

const CHECK_LABEL = {
  METHOD_A_EQUALS_SOURCE_VALID_CREDITS: 'Method A credits = source credits (≥ 0)',
  QUARANTINE_EQUALS_SOURCE_NEGATIVE_CREDITS: 'Quarantined = source negative credits',
  REPORT_MONTHS_RECONCILE: 'Every report-month reconciles',
  METHOD_B_PLUS_UNALLOCATED_EQUALS_METERED: 'Method B + unallocated = metered bill',
  METERED_QUERY_CREDITS_EQUAL_ATTRIBUTION: 'Metered query credits = attribution',
  NO_UNIT_COST_ON_ZERO_VIEWS: 'No unit cost on zero-view months',
};

function CostTrend() {
  const [view, setView] = useState('chart');
  const { data } = useApi('/api/costs/trend');
  const rows = data?.months ?? [];
  return (
    <Panel
      title="Monthly spend · Snowflake vs AWS hosting"
      sub="Method-A attributed Snowflake cost and AWS hosting cost per month (USD)"
      actions={<Segmented label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
    >
      <div className="legend" style={{ marginBottom: 10 }}>
        <span><i className="line" style={{ background: C.accent }} />Snowflake compute</span>
        <span><i className="line" style={{ background: C.series2 }} />AWS hosting</span>
      </div>
      <ChartOrTable
        view={view}
        chart={
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid {...grid} />
              <XAxis {...axis} dataKey="period_month" tickFormatter={fmtMonthShort} interval={2} />
              <YAxis {...axis} tickFormatter={fmtUsdCompact} width={56} />
              <Tooltip cursor={{ stroke: C.hairlineLit }} content={<ChartTooltip labelFormatter={fmtMonth} rows={(p) => p.map((x) => ({ color: x.color, name: x.name, value: fmtUsd(x.value, 0) }))} />} />
              <Line dataKey="snowflake_cost_usd" name="Snowflake" stroke={C.accent} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: C.panel, strokeWidth: 2 }} isAnimationActive={false} />
              <Line dataKey="aws_cost_usd" name="AWS hosting" stroke={C.series2} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: C.panel, strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        }
        table={
          <table>
            <thead><tr><th>Month</th><th className="r">Views</th><th className="r">Credits</th><th className="r">Snowflake $</th><th className="r">AWS $</th><th className="r">Snowflake $/view</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period_month}><td>{fmtMonth(r.period_month)}</td><td className="num r">{fmtInt(r.views)}</td><td className="num r">{fmtInt(r.snowflake_credits)}</td><td className="num r">{fmtUsd(r.snowflake_cost_usd, 0)}</td><td className="num r">{fmtUsd(r.aws_cost_usd, 0)}</td><td className="num r">{fmtUsd(r.snowflake_cost_per_view_usd, 3)}</td></tr>
              ))}
            </tbody>
          </table>
        }
      />
    </Panel>
  );
}

function UnitCostRanking({ reports }) {
  const [view, setView] = useState('chart');
  const top = reports.slice(0, 15);
  return (
    <Panel
      title="Fully loaded cost per active view · top 15 reports"
      sub="(Snowflake credits × price + AWS hosting) ÷ monthly active views, lifetime · ★ = decommission candidate"
      actions={<Segmented label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table · all 100' }]} />}
    >
      <ChartOrTable
        view={view}
        chart={
          <ResponsiveContainer width="100%" height={top.length * 26 + 30}>
            <BarChart data={top} layout="vertical" margin={{ top: 0, right: 56, left: 8, bottom: 0 }}>
              <CartesianGrid {...grid} vertical horizontal={false} />
              <XAxis {...axis} type="number" tickFormatter={(v) => `$${v.toFixed(1)}`} />
              <YAxis {...axis} type="category" dataKey="report_id" width={78} tickFormatter={(id) => (top.find((r) => r.report_id === id)?.is_decommission_candidate ? `★ ${id}` : id)} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                content={<ChartTooltip labelFormatter={(l, p) => `${l} · ${p[0].payload.report_name}`} rows={(p) => [
                  { color: C.accent, name: 'fully loaded / view', value: fmtUsd(p[0].payload.fully_loaded_cost_per_view_usd, 3) },
                  { name: 'Snowflake / view', value: fmtUsd(p[0].payload.snowflake_cost_per_view_usd, 3) },
                  { name: 'lifetime views', value: fmtInt(p[0].payload.total_views) },
                ]} />}
              />
              <GradientDefs colors={[C.accent, '#8a5a2e']} horizontal />
              <Bar
                dataKey="fully_loaded_cost_per_view_usd"
                barSize={14}
                isAnimationActive={false}
                shape={(p) => <CapBar {...p} horizontal color={p.payload.is_decommission_candidate ? C.accent : '#8a5a2e'} />}
                label={{ position: 'right', fill: C.text2, fontSize: 11, formatter: (v) => fmtUsd(v) }}
              />
            </BarChart>
          </ResponsiveContainer>
        }
        table={
          <table>
            <thead><tr><th>Report</th><th className="r">Views</th><th className="r">Credits</th><th className="r">Snowflake $/view</th><th className="r">AWS $/view</th><th className="r">Fully loaded $/view</th><th className="r">A vs B</th><th>Flags</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.report_id} className={r.is_decommission_candidate ? 'flagged' : ''}>
                  <td><Link className="mono" to={`/reports/${r.report_id}`}>{r.report_id}</Link></td>
                  <td className="num r">{fmtInt(r.total_views)}</td>
                  <td className="num r">{fmtInt(r.snowflake_credits)}</td>
                  <td className="num r">{fmtUsd(r.snowflake_cost_per_view_usd, 3)}</td>
                  <td className="num r">{fmtUsd(r.aws_cost_per_view_usd, 3)}</td>
                  <td className="num r">{fmtUsd(r.fully_loaded_cost_per_view_usd, 3)}</td>
                  <td className="num r">{fmtPct(r.method_difference_pct)}</td>
                  <td className="row" style={{ gap: 4 }}>
                    {r.is_decommission_candidate === 1 && <span className="pill warn">decommission?</span>}
                    {r.months_quarantined > 0 && <span className="pill">{r.months_quarantined} quarantined</span>}
                    {r.months_zero_views > 0 && <span className="pill">{r.months_zero_views} zero-view</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />
    </Panel>
  );
}

function Discrepancy({ correlation }) {
  const { data } = useApi('/api/costs/discrepancy');
  const [normal, flagged] = useMemo(() => {
    const pts = data?.points ?? [];
    const isFlag = (p) => p.is_cost_per_view_outlier || p.is_zero_view_cost || p.is_peak_exceeds_views;
    return [pts.filter((p) => !isFlag(p)), pts.filter(isFlag)];
  }, [data]);
  const r = correlation.find((c) => c.grain === 'report-month');
  return (
    <Panel title="AWS hosting cost vs active usage" sub={`Each dot is a report-month · Pearson r = ${r ? fmtNum(r.pearson_views_vs_aws_cost, 3) : '—'} — cost does not track usage`}>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span><i style={{ background: '#5d636c', borderRadius: '50%' }} />Within expected cost/view</span>
        <span><i style={{ background: C.accent, borderRadius: '50%' }} />Flagged: cost/view &gt; {data ? fmtUsd(data.fence.fence) : '…'} fence, zero views, or peak &gt; views ({flagged.length})</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid {...grid} />
          <XAxis {...axis} type="number" dataKey="monthly_active_views" name="views" tickFormatter={fmtCompact} />
          <YAxis {...axis} type="number" dataKey="aws_hosting_cost_usd" name="AWS cost" tickFormatter={(v) => `$${v}`} width={48} />
          <Tooltip
            cursor={{ stroke: C.hairlineLit }}
            content={<ChartTooltip labelFormatter={(_l, p) => `${p[0].payload.report_id} · ${fmtMonth(p[0].payload.period_month)}`} rows={(p) => {
              const d = p[0].payload;
              return [
                { name: 'AWS hosting', value: fmtUsd(d.aws_hosting_cost_usd) },
                { name: 'active views', value: fmtInt(d.monthly_active_views) },
                { name: 'cost / view', value: d.aws_cost_per_view_usd == null ? 'undefined (0 views)' : fmtUsd(d.aws_cost_per_view_usd, 3) },
              ];
            }} />}
          />
          <Scatter data={normal} isAnimationActive={false} shape={(d) => <circle cx={d.cx} cy={d.cy} r={2} fill="#6b717a" fillOpacity={0.55} />} />
          <Scatter data={flagged} isAnimationActive={false} shape={(d) => <circle cx={d.cx} cy={d.cy} r={2.5} fill={C.accent} />} />
        </ScatterChart>
      </ResponsiveContainer>
    </Panel>
  );
}

export function Costs() {
  const { data: s, error } = useApi('/api/costs/summary');
  const { data: rep } = useApi('/api/costs/reports?sort=cost_per_view&limit=100');
  const { data: cb } = useApi('/api/costs/chargeback');
  useRouteLoaded(Boolean(s && rep), '/costs');
  if (error) return <ErrorState error={error} />;
  if (!s || !rep) return <Loading what="cost allocation" />;
  const p = s.portfolio;
  const neg = s.quarantine.find((q) => q.attribution_status === 'NEGATIVE_CREDITS');
  const allPass = s.reconciliation.every((c) => c.status === 'PASS');

  return (
    <div className="stack">
      <PageHead title="Cost Allocation" actions={<span className="meta">{fmtUsd(s.pricing.credit_price_usd)} / credit</span>}>
        Snowflake credits attributed to individual reports from (simulated) <span className="mono">ACCOUNT_USAGE</span> logs via
        each query’s <span className="mono">QUERY_TAG</span>, then divided by monthly active views. Negative credits are
        quarantined, not abs()’d or zeroed. Same SQL as <span className="mono">sql/snowflake/</span>.
      </PageHead>
      <div className="kpis hero-grid">
        <Kpi
          wide
          label="Fully loaded cost per active view"
          value={fmtUsd(p.fully_loaded_cost_per_view_usd)}
          foot={`${fmtUsd(p.snowflake_cost_per_view_usd)} Snowflake compute + ${fmtUsd(p.aws_cost_per_view_usd)} AWS hosting across ${fmtInt(p.total_views)} views`}
        />
        <Kpi label="Snowflake spend" value={fmtUsdCompact(p.snowflake_cost_usd)} foot={`${fmtInt(p.snowflake_credits)} credits attributed to reports`} />
        <Kpi label="AWS hosting spend" value={fmtUsdCompact(p.aws_cost_usd)} foot="Portal-side cost, from the monitoring export" />
        <Kpi label="Unowned spend" to="/orphans" toLabel="Open orphaned reports" value={fmtUsdCompact(s.orphans.orphaned_total_cost_usd)} foot={<Link to="/orphans">{s.orphans.orphaned_report_months} orphaned report-months →</Link>} />
        <Kpi label="Quarantined credits" value={neg ? fmtNum(neg.credits, 2) : '0'} flag foot={neg ? `${neg.query_rows} attribution rows on ${neg.reports_affected} reports (negative at source)` : 'None'} />
        <Kpi label="AWS cost/view outliers" value={s.discrepancy.cost_per_view_outlier_rows} foot={`> ${fmtUsd(s.discrepancy.outlier_fence_usd)} fence (Q3 + 3×IQR) · ${s.discrepancy.zero_view_cost_rows} zero-view months`} />
        <Kpi label="Impossible usage" value={s.discrepancy.peak_exceeds_views_rows} foot="Report-months with peak concurrent users > monthly views" />
      </div>

      <div className="grid grid-12">
        <div className="span-7"><UnitCostRanking reports={rep.reports} /></div>
        <div className="span-5 stack" style={{ gap: 40 }}>
          <Panel title="Reconciliation" sub="sql/snowflake/09 — every check must pass" actions={<SeverityBadge severity={allPass ? 'OK' : 'CRITICAL'} label={allPass ? 'All pass' : 'Failing'} />} flush>
            <table>
              <tbody>
                {s.reconciliation.map((c) => (
                  <tr key={c.check_no}>
                    <td style={{ width: 28 }} className="num dim">{c.check_no}</td>
                    <td>{CHECK_LABEL[c.check_name] ?? c.check_name}</td>
                    <td className="num r">{Number(c.actual).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                    <td className="r"><SeverityBadge severity={c.status === 'PASS' ? 'OK' : 'CRITICAL'} label={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Warehouse idle (simulated)" sub="Metered compute not attributable to any query — Method B spreads it, Method A excludes it" flush>
            <table>
              <thead><tr><th>Warehouse</th><th className="r">Metered</th><th className="r">Idle</th><th className="r">Idle share</th></tr></thead>
              <tbody>
                {s.warehouseIdle.map((w) => (
                  <tr key={w.warehouse_name}><td className="mono" style={{ fontSize: 12 }}>{w.warehouse_name}</td><td className="num r">{fmtInt(w.credits_metered)}</td><td className="num r">{fmtInt(w.credits_idle)}</td><td className="num r">{fmtPct(w.idle_share)}</td></tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      <div className="grid grid-2">
        <CostTrend />
        <Discrepancy correlation={s.correlation} />
      </div>

      <Panel title="Chargeback by owner" sub="Lifetime spend by the owner recorded in each period · orphaned spend has no one to bill" flush>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cost owner</th><th className="r">Views</th><th className="r">Credits</th><th className="r">Snowflake</th><th className="r">AWS</th><th className="r">Total</th><th className="r">Share</th></tr></thead>
            <tbody>
              {(cb?.owners ?? []).map((o) => {
                const total = cb.owners.reduce((a, x) => a + x.total_cost_usd, 0);
                return (
                  <tr key={o.cost_owner} className={o.cost_owner.startsWith('UNOWNED') ? 'flagged' : ''}>
                    <td className={o.cost_owner.startsWith('UNOWNED') ? 'accent' : 'mono'}>{o.cost_owner}</td>
                    <td className="num r">{fmtInt(o.views)}</td><td className="num r">{fmtInt(o.snowflake_credits)}</td>
                    <td className="num r">{fmtUsd(o.snowflake_cost_usd, 0)}</td><td className="num r">{fmtUsd(o.aws_cost_usd, 0)}</td>
                    <td className="num r">{fmtUsd(o.total_cost_usd, 0)}</td><td className="num r">{fmtPct(o.total_cost_usd / total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
