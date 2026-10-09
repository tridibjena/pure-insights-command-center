import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse } from '../errors.js';

const SORTS = {
  total_cost: 'total_cost_usd',
  cost_per_view: 'fully_loaded_cost_per_view_usd',
  snowflake_cost_per_view: 'snowflake_cost_per_view_usd',
  credits: 'snowflake_credits',
  views: 'total_views',
};

export function costsRouter({ pool }) {
  const router = Router();

  router.get('/summary', async (_req, res) => {
    const [portfolio, reconciliation, quarantine, idle, discrepancy, correlation, orphans, pricing] = await Promise.all([
      pool.query('SELECT * FROM cost.v_unit_cost_portfolio'),
      pool.query('SELECT * FROM cost.v_reconciliation_checks ORDER BY check_no'),
      pool.query('SELECT * FROM cost.v_quarantine_summary ORDER BY attribution_status'),
      pool.query('SELECT * FROM cost.v_warehouse_idle ORDER BY warehouse_name'),
      pool.query('SELECT * FROM cost.v_aws_usage_discrepancy_summary'),
      pool.query('SELECT * FROM cost.v_aws_usage_correlation'),
      pool.query('SELECT * FROM cost.v_orphaned_cost_summary'),
      pool.query('SELECT currency, credit_price_usd FROM portal.credit_pricing'),
    ]);
    res.json({
      pricing: pricing.rows[0],
      portfolio: portfolio.rows[0],
      reconciliation: reconciliation.rows,
      quarantine: quarantine.rows,
      warehouseIdle: idle.rows,
      discrepancy: discrepancy.rows[0],
      correlation: correlation.rows,
      orphans: orphans.rows[0],
    });
  });

  router.get('/reports', async (req, res) => {
    const q = parse(
      z.object({
        sort: z.enum(Object.keys(SORTS)).default('cost_per_view'),
        order: z.enum(['asc', 'desc']).default('desc'),
        limit: z.coerce.number().int().min(1).max(100).default(100),
      }),
      req.query,
    );
    const { rows } = await pool.query(
      `SELECT r.*, m.credits_method_b, m.difference_pct AS method_difference_pct
         FROM cost.v_report_cost_ranking r
         LEFT JOIN cost.v_attribution_method_comparison m USING (report_id)
        ORDER BY ${SORTS[q.sort]} ${q.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST
        LIMIT $1`,
      [q.limit],
    );
    res.json({ reports: rows });
  });

  router.get('/reports/:reportId', async (req, res) => {
    const id = req.params.reportId;
    const [{ rows: months }, { rows: [lifetime] }, { rows: methodB }] = await Promise.all([
      pool.query('SELECT * FROM cost.v_unit_cost_report_month WHERE report_id = $1 ORDER BY period_month', [id]),
      pool.query('SELECT * FROM cost.v_report_cost_ranking WHERE report_id = $1', [id]),
      pool.query('SELECT period_month, credits_allocated FROM cost.v_report_month_credits_method_b WHERE report_id = $1 ORDER BY period_month', [id]),
    ]);
    if (!lifetime) throw notFound('Report');
    res.json({ lifetime, months, methodB });
  });

  router.get('/trend', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM cost.v_cost_trend_month ORDER BY period_month');
    res.json({ months: rows });
  });

  router.get('/chargeback', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM cost.v_chargeback_owner ORDER BY total_cost_usd DESC');
    res.json({ owners: rows });
  });

  router.get('/discrepancy', async (_req, res) => {
    const [{ rows: points }, { rows: [fence] }] = await Promise.all([
      pool.query(
        `SELECT report_id, period_month, monthly_active_views, concurrent_user_peak, aws_hosting_cost_usd,
                aws_cost_per_view_usd, is_zero_view_cost, is_peak_exceeds_views, is_cost_per_view_outlier
           FROM cost.v_aws_usage_discrepancy ORDER BY report_id, period_month`,
      ),
      pool.query('SELECT q1, median, q3, q3 + 3 * (q3 - q1) AS fence FROM cost.v_aws_cost_per_view_fence'),
    ]);
    res.json({ fence, points });
  });

  return router;
}
