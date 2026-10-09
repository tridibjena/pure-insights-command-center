import { Router } from 'express';
import { requirePermission } from '../auth/middleware.js';

export function healthRouter({ pool, hub, replayer, metrics }) {
  const router = Router();

  // Public liveness probe (no data exposed).
  router.get('/', async (_req, res) => {
    const started = performance.now();
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up', dbLatencyMs: Math.round((performance.now() - started) * 10) / 10 });
  });

  // Platform self-health for the System Health page.
  router.get('/system', requirePermission(pool, 'health:read'), async (_req, res) => {
    const started = performance.now();
    const { rows: [db] } = await pool.query(`
      SELECT (SELECT count(*) FROM app.telemetry_events WHERE received_at > now() - interval '5 minutes') AS events_5m,
             (SELECT count(*) FROM app.telemetry_events) AS events_total,
             (SELECT count(*) FROM app.alerts WHERE status <> 'RESOLVED') AS live_alerts,
             (SELECT max(received_at) FROM app.telemetry_events) AS last_event_at`);
    const dbLatencyMs = Math.round((performance.now() - started) * 10) / 10;
    const mem = process.memoryUsage();
    res.json({
      database: { status: 'up', latencyMs: dbLatencyMs, poolTotal: pool.totalCount, poolIdle: pool.idleCount },
      websocket: hub.stats(),
      replay: replayer.status(),
      telemetry: { eventsLast5m: db.events_5m, eventsTotal: db.events_total, lastEventAt: db.last_event_at },
      liveAlerts: db.live_alerts,
      api: metrics.summary(),
      process: { uptimeSec: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1048576), node: process.version },
    });
  });

  return router;
}
