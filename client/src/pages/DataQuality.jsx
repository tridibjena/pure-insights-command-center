import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api/client.js';
import { SeverityBadge } from '../components/Severity.jsx';
import { ErrorState, Kpi, Loading, PageHead, Pagination, Panel } from '../components/ui.jsx';
import { fmtInt, fmtNum } from '../format.js';
import { useApi } from '../hooks/useApi.js';
import { useRouteLoaded } from '../rum.js';

const fmtMoneyless = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RULE_SEVERITY = { INFO: 'OK', WARNING: 'WARNING', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

export function DataQuality() {
  const { data: s, error } = useApi('/api/data-quality/summary');
  const { data: rules } = useApi('/api/data-quality/rules');
  const [rule, setRule] = useState('DQ_NEGATIVE_CREDITS');
  const [page, setPage] = useState(1);
  const { data: issues, loading } = useApi(`/api/data-quality/issues${qs({ rule, page, pageSize: 12 })}`);
  const { data: forensics } = useApi('/api/data-quality/forensics');
  useRouteLoaded(Boolean(s && rules), '/data-quality');
  if (error) return <ErrorState error={error} />;
  if (!s || !rules) return <Loading what="data quality" />;
  const selected = rules.rules.find((r) => r.rule_code === rule);

  return (
    <div className="stack">
      <PageHead title="Data Quality">
        Every injected defect in <span className="mono">{s.source_file}</span> is detected programmatically, recorded in the
        anomaly register and handled by an explicit policy. No row is dropped; raw values are always kept for audit.
      </PageHead>
      <div className="kpis">
        <Kpi label="Rows landed" value={fmtInt(s.raw_rows)} foot={`${s.reports} reports × ${s.snapshots} snapshots — no timestamp in source`} />
        <Kpi label="Rows with a defect" value={fmtInt(s.rows_with_defects)} foot={`${fmtInt(s.issues)} register entries across ${rules.rules.length} rules`} />
        <Kpi label="Credits after quarantine" value={fmtInt(s.credits_clean_total)} foot={`raw ${fmtMoneyless(s.credits_raw_total)} → clean ${fmtMoneyless(s.credits_clean_total)} (${fmtInt(s.negative_credit_rows)} negatives removed)`} />
        <Kpi label="Worst load latency" value={fmtNum(s.max_latency_sec)} unit="s" flag foot={`${s.rows_at_max_latency} rows at the ceiling · kept, never capped`} />
      </div>
      <div className="note">
        <strong>The alert threshold is {s.latencyAlertThresholdSec} s; {fmtNum(s.max_latency_sec)} s is the dataset’s most extreme load, not a threshold.</strong>{' '}
        Latency spikes are genuine performance signal, so they are annotated and alerted on — never capped, winsorised or removed.
        {` ${s.rows_exactly_at_threshold} readings of exactly ${s.latencyAlertThresholdSec}.0 s correctly do not alert ("exceeds" is strict). `}
        Only invalid readings (≤ 0 s or above a 300 s sanity ceiling) would be quarantined — there are none.
      </div>
      <Panel title="Anomaly register" sub="Click a rule to inspect the affected rows" flush>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rule</th><th>Defect</th><th>Column</th><th>Severity</th><th>Action</th><th className="r">Rows</th><th className="r">Reports</th></tr></thead>
            <tbody>
              {rules.rules.map((r) => (
                <tr key={r.rule_code} className={`clickable ${r.rule_code === rule ? 'flagged' : ''}`} onClick={() => { setRule(r.rule_code); setPage(1); }}>
                  <td className="mono" style={{ fontSize: 12 }}>{r.rule_code}</td>
                  <td>{r.title}</td>
                  <td className="mono dim" style={{ fontSize: 12 }}>{r.column_name}</td>
                  <td><SeverityBadge severity={RULE_SEVERITY[r.severity]} label={r.severity} /></td>
                  <td><span className={`pill ${r.action === 'QUARANTINE' || r.action === 'NULLIFY' ? 'warn' : ''}`}>{r.action}</span></td>
                  <td className="num r">{fmtInt(r.rows_affected)}</td>
                  <td className="num r">{r.reports_affected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {forensics?.checks?.length > 0 && (
        <Panel
          title="Forensic checks"
          sub="Statistical tests behind the dataset's structure — each answers a question the data raises and sets how the pipeline treats it"
        >
          <div className="stack" style={{ gap: 22 }}>
            {forensics.checks.map((c) => (
              <div key={c.check_code} className="forensic">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h3>{c.ordinal} · {c.title}</h3>
                  <span className="pill">{c.check_code}</span>
                </div>
                <p className="muted" style={{ margin: '6px 0 8px' }}>{c.question}</p>
                <div className="forensic-grid">
                  <span className="label">Method</span><span>{c.method}</span>
                  <span className="label">Result</span><span className="mono" style={{ fontSize: 12 }}>{c.result}</span>
                  <span className="label">Conclusion</span><span style={{ color: 'var(--text)' }}>{c.conclusion}</span>
                  <span className="label">Treatment</span><span>{c.treatment}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {selected && (
        <Panel title={selected.title} sub={<><span className="mono">{selected.detection}</span> → {selected.remediation}</>} flush>
          <div className={`table-wrap ${loading ? 'stale' : ''}`}>
            <table>
              <thead><tr><th>CSV row</th><th>Report</th><th>Snapshot</th><th>Raw value</th><th>Detail</th><th>Action</th></tr></thead>
              <tbody>
                {(issues?.issues ?? []).map((i) => (
                  <tr key={i.issue_id}>
                    <td className="num">{i.source_row_number}</td>
                    <td><Link className="mono" to={`/reports/${i.report_id}`}>{i.report_id}</Link></td>
                    <td className="num">#{i.snapshot_seq}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{i.raw_value}</td>
                    <td className="muted">{i.detail}</td>
                    <td className="mono dim" style={{ fontSize: 11 }}>{i.action_taken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {issues && issues.total === 0 && <div className="empty">No rows triggered this rule.</div>}
            {issues && issues.total > 0 && <Pagination page={issues.page} pageSize={issues.pageSize} total={issues.total} onPage={setPage} />}
          </div>
        </Panel>
      )}
    </div>
  );
}
