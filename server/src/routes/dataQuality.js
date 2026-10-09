import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../errors.js';

export function dataQualityRouter({ pool, config }) {
  const router = Router();

  router.get('/summary', async (_req, res) => {
    const { rows: [s] } = await pool.query(
      `SELECT (SELECT count(*) FROM raw.report_monitoring_csv)                         AS raw_rows,
              (SELECT count(*) FROM app.report_observations)                           AS observations,
              (SELECT count(*) FROM app.reports)                                       AS reports,
              (SELECT max(snapshot_seq) FROM app.report_observations)                  AS snapshots,
              (SELECT count(*) FROM app.dq_issues)                                     AS issues,
              (SELECT count(DISTINCT source_row_number) FROM app.dq_issues WHERE rule_code <> 'DQ_OWNER_CHURN') AS rows_with_defects,
              (SELECT max(avg_load_time_sec) FROM app.report_observations)             AS max_latency_sec,
              (SELECT count(*) FROM app.report_observations
                WHERE avg_load_time_sec = (SELECT max(avg_load_time_sec) FROM app.report_observations)) AS rows_at_max_latency,
              (SELECT count(*) FROM app.report_observations WHERE avg_load_time_sec = $1) AS rows_exactly_at_threshold,
              (SELECT sum(credits_raw) FROM app.report_observations)                   AS credits_raw_total,
              (SELECT sum(credits_clean) FROM app.report_observations)                 AS credits_clean_total,
              (SELECT min(source_file) FROM raw.report_monitoring_csv)                 AS source_file`,
      [config.thresholds.latencyAlertSec],
    );
    res.json({ ...s, latencyAlertThresholdSec: config.thresholds.latencyAlertSec });
  });

  router.get('/rules', async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT r.*, count(i.issue_id)::int AS rows_affected, count(DISTINCT i.report_id)::int AS reports_affected
         FROM app.dq_rules r LEFT JOIN app.dq_issues i USING (rule_code)
        GROUP BY r.rule_code ORDER BY count(i.issue_id) DESC`,
    );
    res.json({ rules: rows });
  });

  router.get('/issues', async (req, res) => {
    const q = parse(
      z.object({
        rule: z.string().max(60).optional(),
        reportId: z.string().max(40).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );
    const { rows } = await pool.query(
      `SELECT i.issue_id, i.source_row_number, i.report_id, i.snapshot_seq, i.rule_code, i.column_name, i.raw_value,
              i.detail, i.action_taken, count(*) OVER () AS total_count
         FROM app.dq_issues i
        WHERE ($1::text IS NULL OR i.rule_code = $1) AND ($2::text IS NULL OR i.report_id = $2)
        ORDER BY i.rule_code, i.source_row_number
        LIMIT $3 OFFSET $4`,
      [q.rule ?? null, q.reportId ?? null, q.pageSize, (q.page - 1) * q.pageSize],
    );
    res.json({ page: q.page, pageSize: q.pageSize, total: rows[0]?.total_count ?? 0, issues: rows.map(({ total_count: _t, ...r }) => r) });
  });

  return router;
}
