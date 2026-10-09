import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../errors.js';

const SEVERITY_ORDER = `CASE severity WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2 ELSE 1 END`;

export function dashboardRouter({ pool, config }) {
  const router = Router();
  const t = config.thresholds;

  router.get('/summary', async (_req, res) => {
    const { rows: [k] } = await pool.query(
      `WITH latest AS (
         SELECT * FROM app.report_observations
          WHERE snapshot_seq = (SELECT max(snapshot_seq) FROM app.report_observations)
       )
       SELECT
         (SELECT max(snapshot_seq) FROM latest)                                         AS latest_snapshot,
         (SELECT max(period_month) FROM latest)                                         AS latest_period,
         (SELECT count(*) FROM latest)                                                  AS reports,
         (SELECT count(*) FILTER (WHERE is_latency_breach) FROM latest)                 AS latest_breaching,
         (SELECT count(*) FILTER (WHERE latency_band = 'CRITICAL') FROM latest)         AS latest_critical,
         (SELECT count(*) FILTER (WHERE is_refresh_failure) FROM latest)                AS latest_failing,
         (SELECT count(*) FILTER (WHERE is_status_unknown) FROM latest)                 AS latest_unknown,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_load_time_sec) FROM latest)  AS latest_p50,
         (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY avg_load_time_sec) FROM latest) AS latest_p95,
         (SELECT count(*) FROM app.report_observations)                                 AS observations,
         (SELECT avg(is_latency_breach::int) FROM app.report_observations)              AS breach_rate,
         (SELECT avg(is_refresh_failure::int) FROM app.report_observations)             AS failure_rate,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_load_time_sec) FROM app.report_observations)  AS p50,
         (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY avg_load_time_sec) FROM app.report_observations) AS p95,
         (SELECT max(avg_load_time_sec) FROM app.report_observations)                   AS max_latency,
         (SELECT count(*) FROM app.report_observations
           WHERE avg_load_time_sec = (SELECT max(avg_load_time_sec) FROM app.report_observations)) AS rows_at_max,
         (SELECT count(*) FROM app.v_report_current WHERE is_orphaned)                  AS orphaned_now`,
    );
    const { rows: alertRows } = await pool.query(
      `SELECT severity, count(*)::int AS n FROM app.alerts WHERE status <> 'RESOLVED' GROUP BY severity`,
    );
    const liveAlerts = { WARNING: 0, HIGH: 0, CRITICAL: 0 };
    for (const r of alertRows) liveAlerts[r.severity] = r.n;
    res.json({
      thresholds: t,
      latest: {
        snapshotSeq: k.latest_snapshot,
        periodMonth: k.latest_period,
        reports: k.reports,
        latencyBreaching: k.latest_breaching,
        latencyCritical: k.latest_critical,
        refreshFailing: k.latest_failing,
        statusUnknown: k.latest_unknown,
        p50LatencySec: k.latest_p50,
        p95LatencySec: k.latest_p95,
      },
      allTime: {
        observations: k.observations,
        latencyBreachRate: k.breach_rate,
        refreshFailureRate: k.failure_rate,
        p50LatencySec: k.p50,
        p95LatencySec: k.p95,
        maxLatencySec: k.max_latency,
        rowsAtMaxLatency: k.rows_at_max,
      },
      orphanedReports: k.orphaned_now,
      liveAlerts,
    });
  });

  // Histogram with right-closed 5 s bins, so the 15/30/45 s band edges fall on bin edges
  // and a reading of exactly 15.0 s lands in the OK bin (10, 15].
  router.get('/latency-distribution', async (req, res) => {
    const { scope } = parse(z.object({ scope: z.enum(['all', 'latest']).default('all') }), req.query);
    const { rows } = await pool.query(
      `SELECT ceil(avg_load_time_sec / 5) * 5 AS upper_sec, count(*)::int AS count
         FROM app.report_observations
        WHERE avg_load_time_sec IS NOT NULL
          AND ($1 = 'all' OR snapshot_seq = (SELECT max(snapshot_seq) FROM app.report_observations))
        GROUP BY 1 ORDER BY 1`,
      [scope],
    );
    const band = (upper) =>
      upper <= t.latencyAlertSec ? 'OK' : upper <= t.latencyHighAboveSec ? 'WARNING' : upper <= t.latencyCriticalAboveSec ? 'HIGH' : 'CRITICAL';
    res.json({
      scope,
      thresholdSec: t.latencyAlertSec,
      bins: rows.map((r) => ({ fromSec: r.upper_sec - 5, toSec: r.upper_sec, count: r.count, band: band(r.upper_sec) })),
    });
  });

  router.get('/trend', async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT snapshot_seq, period_month,
              avg(is_latency_breach::int)  AS latency_breach_rate,
              avg(is_refresh_failure::int) AS refresh_failure_rate,
              count(*) FILTER (WHERE refresh_status = 'FAILED')::int    AS failed,
              count(*) FILTER (WHERE refresh_status = 'TIMED_OUT')::int AS timed_out,
              count(*) FILTER (WHERE refresh_status = 'UNKNOWN')::int   AS unknown,
              count(*) FILTER (WHERE is_orphaned)::int                  AS orphaned,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_load_time_sec)  AS p50_latency_sec,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY avg_load_time_sec) AS p95_latency_sec
         FROM app.report_observations GROUP BY snapshot_seq, period_month ORDER BY snapshot_seq`,
    );
    res.json({ snapshots: rows });
  });

  router.get('/slowest', async (req, res) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }), req.query);
    const { rows } = await pool.query(
      `SELECT o.report_id, r.report_name, r.owner_email, r.is_orphaned, o.avg_load_time_sec, o.latency_band,
              o.refresh_status, o.monthly_active_views,
              (SELECT max(${SEVERITY_ORDER}) FROM app.alerts a WHERE a.report_id = o.report_id AND a.status <> 'RESOLVED') AS live_alert_rank
         FROM app.report_observations o
         JOIN app.v_report_current r USING (report_id)
        WHERE o.snapshot_seq = r.latest_snapshot_seq
        ORDER BY o.avg_load_time_sec DESC NULLS LAST
        LIMIT $1`,
      [limit],
    );
    res.json({ reports: rows });
  });

  return router;
}
