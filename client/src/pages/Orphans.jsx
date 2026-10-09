import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { RefreshStatus, SeverityBadge } from '../components/Severity.jsx';
import { ErrorState, Kpi, Loading, Modal, PageHead, Panel } from '../components/ui.jsx';
import { fmtInt, fmtSec, fmtTime, fmtUsd, fmtUsdCompact } from '../format.js';
import { useApi } from '../hooks/useApi.js';
import { useStreamEvent } from '../realtime/AlertStream.jsx';
import { useRouteLoaded } from '../rum.js';

function AssignOwner({ report, onClose, onDone }) {
  const { data } = useApi('/api/orphans/owners');
  const [ownerEmail, setOwnerEmail] = useState(report.last_known_owner ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/orphans/${report.report_id}/assign-owner`, { method: 'POST', body: { ownerEmail, note: note || undefined } });
      onDone();
    } catch (e) {
      setError(e.details?.[0]?.message ?? e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Assign an owner · ${report.report_id}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !ownerEmail} onClick={submit}>Assign owner</button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
        {report.report_name} has had no owner in {report.orphaned_months} of 20 snapshots and carries{' '}
        <strong style={{ color: 'var(--text)' }}>{fmtUsd(report.orphaned_total_cost_usd, 0)}</strong> of unaccountable spend.
        The assignment is applied on top of the source data and written to the audit log.
      </p>
      <label className="field">
        <span className="label">Owner email</span>
        <input className="input" list="owner-options" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="name@company.com" />
        <datalist id="owner-options">
          {(data?.owners ?? []).map((o) => (
            <option key={o.owner_email} value={o.owner_email}>{o.reports_owned} reports</option>
          ))}
        </datalist>
        {report.last_known_owner && <span className="muted" style={{ fontSize: 12 }}>Last known owner: <span className="mono">{report.last_known_owner}</span></span>}
      </label>
      <label className="field">
        <span className="label">Note (optional)</span>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="note" role="alert">{error}</div>}
    </Modal>
  );
}

export function Orphans() {
  const { can } = useAuth();
  const { data, error, reload } = useApi('/api/orphans');
  const [assigning, setAssigning] = useState(null);
  useStreamEvent(['report.owner_changed'], reload);
  useRouteLoaded(Boolean(data), '/orphans');
  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading what="orphaned reports" />;
  const s = data.summary;

  return (
    <div className="stack">
      <PageHead title="Orphaned Reports">
        Reports whose latest snapshot has no owner — the source marks them as <span className="mono">nan</span> or{' '}
        <span className="mono">ORPHANED_REPORT</span>. Without an owner, nobody is accountable for their failures or their spend.
      </PageHead>
      <div className="kpis">
        <Kpi label="Orphaned now" value={s.orphaned_now} unit="reports" flag foot={`${s.reports_ever_orphaned} reports orphaned in ≥ 1 snapshot`} />
        <Kpi label="Orphaned report-months" value={fmtInt(s.orphaned_rows)} foot={`${s.nan_marker_rows} × “nan” · ${s.orphaned_marker_rows} × “ORPHANED_REPORT”`} />
        <Kpi label="Unowned spend" value={fmtUsdCompact(s.orphaned_total_cost_usd)} foot={`Snowflake ${fmtUsdCompact(s.orphaned_snowflake_cost_usd)} + AWS ${fmtUsdCompact(s.orphaned_aws_cost_usd)}`} />
        <Kpi label="Credits with no owner" value={fmtInt(s.orphaned_credits)} unit="credits" foot="Across every orphaned report-month" />
      </div>
      <Panel title="Currently orphaned" sub="Ordered by lifetime unowned spend · exposure covers every month the report had no owner" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Report</th><th>Source marker</th><th>Last known owner</th><th className="r">Orphaned months</th>
                <th className="r">Unowned spend</th><th className="r">Load</th><th>Refresh</th>{can('owners:reassign') && <th />}
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.report_id} className="flagged">
                  <td><Link to={`/reports/${r.report_id}`} className="mono">{r.report_id}</Link><span className="sub-text">{r.report_name}</span></td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.latest_owner_marker}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.last_known_owner ?? '—'}</td>
                  <td className="num r">{r.orphaned_months} / 20</td>
                  <td className="num r">{fmtUsd(r.orphaned_total_cost_usd, 0)}</td>
                  <td className="num r"><span className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>{fmtSec(r.avg_load_time_sec)}<SeverityBadge severity={r.latency_band} /></span></td>
                  <td><RefreshStatus status={r.refresh_status} /></td>
                  {can('owners:reassign') && (
                    <td className="r"><button type="button" className="btn accent sm" onClick={() => setAssigning(r)}>Assign owner</button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {data.reports.length === 0 && <div className="empty">Every report has an owner.</div>}
        </div>
      </Panel>
      {data.reassigned.length > 0 && (
        <Panel title="Recently reassigned" sub="Admin overrides applied on top of the source ownership" flush>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Report</th><th>New owner</th><th>By</th><th>When</th><th>Note</th></tr></thead>
              <tbody>
                {data.reassigned.map((r) => (
                  <tr key={r.report_id}><td className="mono">{r.report_id}</td><td className="mono">{r.owner_email}</td><td>{r.assigned_by}</td><td className="num muted">{fmtTime(r.assigned_at)}</td><td className="muted">{r.note}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {assigning && (
        <AssignOwner
          report={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
