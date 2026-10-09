import { Router } from 'express';
import { z } from 'zod';
import { can } from '../auth/permissions.js';
import { notFound, parse } from '../errors.js';

const SORTS = {
  report_id: 'r.report_id',
  latency: 'o.avg_load_time_sec',
  views: 'o.monthly_active_views',
  breaches: 's.breach_snapshots',
  failures: 's.failure_snapshots',
  alerts: 'COALESCE(a.live_alerts, 0)',
};

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  status: z.enum(['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN']).optional(),
  band: z.enum(['OK', 'WARNING', 'HIGH', 'CRITICAL']).optional(),
  orphaned: z.enum(['true', 'false']).optional(),
  sort: z.enum(Object.keys(SORTS)).default('latency'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const SEVERITY_NAME = `CASE max(CASE severity WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2 ELSE 1 END)
                        WHEN 3 THEN 'CRITICAL' WHEN 2 THEN 'HIGH' ELSE 'WARNING' END`;

export function reportsRouter({ pool }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    const params = [];
    const where = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (req.user.ownerScoped) add('r.owner_email = ?', req.user.owner_email);
    if (q.search) add('(r.report_id ILIKE ? OR r.report_name ILIKE ?)', `%${q.search}%`);
    if (q.status) add('o.refresh_status = ?', q.status);
    if (q.band) add('o.latency_band = ?', q.band);
    if (q.orphaned) add('r.is_orphaned = ?', q.orphaned === 'true');
    params.push(q.pageSize, (q.page - 1) * q.pageSize);

    const { rows } = await pool.query(
      `SELECT r.report_id, r.report_name, r.owner_email, r.is_orphaned, r.has_owner_override,
              o.snapshot_seq, o.period_month, o.refresh_status, o.avg_load_time_sec, o.latency_band,
              o.monthly_active_views, o.concurrent_user_peak, o.aws_hosting_cost_usd, o.credits_clean,
              s.breach_snapshots, s.failure_snapshots, s.orphaned_snapshots, s.p50_latency_sec,
              COALESCE(a.live_alerts, 0) AS live_alerts, a.max_live_severity,
              count(*) OVER () AS total_count
         FROM app.v_report_current r
         JOIN app.report_observations o ON o.report_id = r.report_id AND o.snapshot_seq = r.latest_snapshot_seq
         JOIN (SELECT report_id,
                      count(*) FILTER (WHERE is_latency_breach)::int  AS breach_snapshots,
                      count(*) FILTER (WHERE is_refresh_failure)::int AS failure_snapshots,
                      count(*) FILTER (WHERE is_orphaned)::int        AS orphaned_snapshots,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_load_time_sec) AS p50_latency_sec
                 FROM app.report_observations GROUP BY report_id) s ON s.report_id = r.report_id
         LEFT JOIN (SELECT report_id, count(*)::int AS live_alerts, ${SEVERITY_NAME} AS max_live_severity
                      FROM app.alerts WHERE status <> 'RESOLVED' AND report_id IS NOT NULL GROUP BY report_id) a
                ON a.report_id = r.report_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${SORTS[q.sort]} ${q.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, r.report_id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = rows[0]?.total_count ?? 0;
    res.json({ page: q.page, pageSize: q.pageSize, total, reports: rows.map(({ total_count: _t, ...r }) => r) });
  });

  router.get('/:reportId', async (req, res) => {
    const id = req.params.reportId;
    const { rows: [report] } = await pool.query('SELECT * FROM app.v_report_current WHERE report_id = $1', [id]);
    // Owner-scoped users get 404 (not 403) for reports they don't own, so existence isn't leaked.
    if (!report || (req.user.ownerScoped && report.owner_email !== req.user.owner_email)) throw notFound('Report');

    const [history, alerts, issues] = await Promise.all([
      pool.query(
        `SELECT snapshot_seq, period_month, owner_raw, owner_email, is_orphaned, refresh_status, avg_load_time_sec,
                latency_band, monthly_active_views, concurrent_user_peak, aws_hosting_cost_usd, aws_cost_per_view,
                credits_raw, credits_clean, is_negative_credits, is_zero_view_cost, is_peak_exceeds_views,
                is_aws_cost_per_view_outlier, query_count_last_30d
           FROM app.report_observations WHERE report_id = $1 ORDER BY snapshot_seq`,
        [id],
      ),
      pool.query(
        `SELECT * FROM app.alerts WHERE report_id = $1 ORDER BY (status = 'RESOLVED'), updated_at DESC LIMIT 50`,
        [id],
      ),
      pool.query(
        `SELECT i.rule_code, r.title, i.snapshot_seq, i.raw_value, i.detail, i.action_taken
           FROM app.dq_issues i JOIN app.dq_rules r USING (rule_code)
          WHERE i.report_id = $1 AND i.rule_code <> 'DQ_OWNER_CHURN' ORDER BY i.snapshot_seq, i.rule_code`,
        [id],
      ),
    ]);

    let cost = null;
    if (can(req.user.role, 'costs:read')) {
      const { rows: [c] } = await pool.query('SELECT * FROM cost.v_unit_cost_report WHERE report_id = $1', [id]);
      cost = c ?? null;
    }

    // Owner timeline: collapse consecutive snapshots with the same owner into spans.
    const ownerTimeline = [];
    for (const h of history.rows) {
      const owner = h.owner_email ?? null;
      const last = ownerTimeline.at(-1);
      if (last && last.ownerEmail === owner) last.toSnapshot = h.snapshot_seq;
      else ownerTimeline.push({ ownerEmail: owner, rawValue: h.is_orphaned ? h.owner_raw : null, fromSnapshot: h.snapshot_seq, toSnapshot: h.snapshot_seq });
    }

    res.json({ report, history: history.rows, ownerTimeline, alerts: alerts.rows, dataQualityIssues: issues.rows, cost });
  });

  return router;
}
