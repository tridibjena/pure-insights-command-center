import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requirePermission } from '../auth/middleware.js';
import { notFound, parse } from '../errors.js';

const assignSchema = z.object({
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email()),
  note: z.string().trim().max(500).optional(),
});

export function orphansRouter({ pool, hub }) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const [{ rows: current }, { rows: [summary] }, { rows: reassigned }] = await Promise.all([
      pool.query(
        `SELECT r.report_id, r.report_name, r.orphaned_snapshot_count, r.latest_snapshot_seq, r.distinct_owner_count,
                o.owner_raw AS latest_owner_marker, o.avg_load_time_sec, o.latency_band, o.refresh_status,
                o.monthly_active_views, o.aws_hosting_cost_usd,
                e.orphaned_months, e.orphaned_credits, e.orphaned_snowflake_cost_usd, e.orphaned_aws_cost_usd,
                e.orphaned_total_cost_usd,
                (SELECT owner_email FROM app.report_observations p
                  WHERE p.report_id = r.report_id AND p.owner_email IS NOT NULL
                  ORDER BY p.snapshot_seq DESC LIMIT 1) AS last_known_owner
           FROM app.v_report_current r
           JOIN app.report_observations o ON o.report_id = r.report_id AND o.snapshot_seq = r.latest_snapshot_seq
           LEFT JOIN cost.v_orphaned_cost_exposure e ON e.report_id = r.report_id
          WHERE r.is_orphaned
          ORDER BY e.orphaned_total_cost_usd DESC NULLS LAST`,
      ),
      pool.query(
        `SELECT s.*, (SELECT count(*) FROM app.v_report_current WHERE is_orphaned) AS orphaned_now,
                (SELECT max(snapshot_seq) FROM app.report_observations) AS snapshots,
                (SELECT count(*) FROM app.report_observations WHERE is_orphaned) AS orphaned_rows,
                (SELECT count(*) FILTER (WHERE owner_raw = 'nan') FROM app.report_observations) AS nan_marker_rows,
                (SELECT count(*) FILTER (WHERE owner_raw = 'ORPHANED_REPORT') FROM app.report_observations) AS orphaned_marker_rows
           FROM cost.v_orphaned_cost_summary s`,
      ),
      pool.query(
        `SELECT o.report_id, r.report_name, o.owner_email, o.assigned_by, o.assigned_at, o.note
           FROM app.owner_overrides o JOIN app.reports r USING (report_id) ORDER BY o.assigned_at DESC`,
      ),
    ]);
    res.json({ summary, reports: current, reassigned });
  });

  router.get('/owners', requirePermission(pool, 'owners:reassign'), async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT owner_email, count(*)::int AS reports_owned
         FROM app.v_report_current WHERE owner_email IS NOT NULL GROUP BY owner_email ORDER BY owner_email`,
    );
    res.json({ owners: rows });
  });

  router.post('/:reportId/assign-owner', requirePermission(pool, 'owners:reassign'), async (req, res) => {
    const { ownerEmail, note } = parse(assignSchema, req.body);
    const id = req.params.reportId;
    const { rows: [report] } = await pool.query('SELECT report_id, owner_email FROM app.v_report_current WHERE report_id = $1', [id]);
    if (!report) throw notFound('Report');
    await pool.query(
      `INSERT INTO app.owner_overrides (report_id, owner_email, assigned_by, note) VALUES ($1, $2, $3, $4)
       ON CONFLICT (report_id) DO UPDATE SET owner_email = EXCLUDED.owner_email, assigned_by = EXCLUDED.assigned_by,
                                             assigned_at = now(), note = EXCLUDED.note`,
      [id, ownerEmail, req.user.email, note ?? null],
    );
    await audit(pool, { req, action: 'owner.reassign', target: id, detail: { from: report.owner_email, to: ownerEmail, note } });
    await hub.refreshScopes();
    const { rows: [updated] } = await pool.query('SELECT * FROM app.v_report_current WHERE report_id = $1', [id]);
    hub.broadcast('report.owner_changed', updated, { reportId: id, permission: 'reports:read' });
    res.json({ report: updated });
  });

  return router;
}
