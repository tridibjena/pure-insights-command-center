import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requirePermission } from '../auth/middleware.js';
import { withTransaction } from '../db.js';
import { HttpError, notFound, parse } from '../errors.js';
import { acknowledge, resolveManually } from '../services/alertService.js';

const listQuery = z.object({
  status: z.enum(['live', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'all']).default('live'),
  severity: z.enum(['WARNING', 'HIGH', 'CRITICAL']).optional(),
  rule: z.enum(['LATENCY_SLO_BREACH', 'REFRESH_FAILURE', 'TELEMETRY_GAP', 'RUM_SLOW_LOAD']).optional(),
  reportId: z.string().max(40).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function alertsRouter({ pool, hub }) {
  const router = Router();

  // Row scope for REPORT_OWNER. `column` names the alert's report_id column (qualified when the query
  // joins); the subquery's own report_id is never rewritten, so the filter can't collapse to TRUE.
  function scopeSql(user, params, column = 'report_id') {
    if (!user.ownerScoped) return 'TRUE';
    params.push(user.owner_email);
    return `${column} IN (SELECT v.report_id FROM app.v_report_current v WHERE v.owner_email = $${params.length})`;
  }

  async function loadScoped(user, id) {
    const params = [id];
    const { rows: [alert] } = await pool.query(
      `SELECT * FROM app.alerts WHERE alert_id = $1 AND ${scopeSql(user, params)}`,
      params,
    );
    if (!alert) throw notFound('Alert');
    return alert;
  }

  router.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    const params = [];
    const where = [scopeSql(req.user, params)];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.status === 'live') where.push(`status <> 'RESOLVED'`);
    else if (q.status !== 'all') add('status = ?', q.status);
    if (q.severity) add('severity = ?', q.severity);
    if (q.rule) add('rule_code = ?', q.rule);
    if (q.reportId) add('report_id = ?', q.reportId);
    if (q.since) add('updated_at > ?', q.since);
    params.push(q.limit);
    const { rows } = await pool.query(
      `SELECT * FROM app.alerts WHERE ${where.join(' AND ')}
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2 ELSE 1 END DESC, updated_at DESC
        LIMIT $${params.length}`,
      params,
    );
    res.json({ alerts: rows, serverTime: new Date().toISOString() });
  });

  router.get('/stats', async (req, res) => {
    const params = [];
    const { rows } = await pool.query(
      `SELECT status, severity, rule_code, count(*)::int AS n FROM app.alerts WHERE ${scopeSql(req.user, params)}
        GROUP BY status, severity, rule_code`,
      params,
    );
    const recentParams = [];
    const { rows: [recent] } = await pool.query(
      `SELECT count(*) FILTER (WHERE event_type = 'RAISED')::int AS raised,
              count(*) FILTER (WHERE event_type = 'ESCALATED')::int AS escalated,
              count(*) FILTER (WHERE event_type = 'RESOLVED')::int AS resolved,
              count(*) FILTER (WHERE event_type = 'REPEATED')::int AS deduplicated
         FROM app.alert_events e JOIN app.alerts a USING (alert_id)
        WHERE e.at > now() - interval '1 hour' AND ${scopeSql(req.user, recentParams, 'a.report_id')}`,
      recentParams,
    );
    res.json({ breakdown: rows, lastHour: recent });
  });

  router.get('/:alertId', async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.alertId);
    const alert = await loadScoped(req.user, id);
    const { rows: events } = await pool.query('SELECT * FROM app.alert_events WHERE alert_id = $1 ORDER BY at, alert_event_id', [id]);
    res.json({ alert, events });
  });

  router.post('/:alertId/acknowledge', requirePermission(pool, 'alerts:ack'), async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.alertId);
    const { note } = parse(z.object({ note: z.string().trim().max(500).optional() }), req.body ?? {});
    await loadScoped(req.user, id);
    const alert = await withTransaction(pool, (c) => acknowledge(c, id, req.user, note));
    if (!alert) throw new HttpError(409, 'INVALID_STATE', 'Only OPEN alerts can be acknowledged');
    await audit(pool, { req, action: 'alert.acknowledge', target: String(id) });
    hub.broadcast('alert.acknowledged', alert, { reportId: alert.report_id });
    res.json({ alert });
  });

  router.post('/:alertId/resolve', requirePermission(pool, 'alerts:ack'), async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.alertId);
    const { resolution } = parse(z.object({ resolution: z.string().trim().min(3).max(500) }), req.body ?? {});
    await loadScoped(req.user, id);
    const alert = await withTransaction(pool, (c) => resolveManually(c, id, req.user, resolution));
    if (!alert) throw new HttpError(409, 'INVALID_STATE', 'Alert is already resolved');
    await audit(pool, { req, action: 'alert.resolve', target: String(id), detail: { resolution } });
    hub.broadcast('alert.resolved', alert, { reportId: alert.report_id });
    res.json({ alert });
  });

  return router;
}
