import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { audit } from '../audit.js';
import { authenticate, requireApiKey, requirePermission } from '../auth/middleware.js';
import { badRequest, HttpError, parse } from '../errors.js';
import { clientLoadSchema, reportEventSchema } from '../services/telemetryIngest.js';

const batchSchema = z.object({ events: z.array(z.unknown()).min(1).max(500) });
const rumSchema = clientLoadSchema.omit({ type: true });
const configSchema = z.object({
  intervalMs: z.number().int().min(1000).max(120_000).optional(),
  loop: z.boolean().optional(),
  pauseAfterSnapshot: z.number().int().min(1).max(1000).nullable().optional(),
});

export function telemetryRouter({ pool, config, ingest, replayer }) {
  const router = Router();
  const userAuth = authenticate({ pool, config });

  // External collectors (SERVICE role, X-API-Key). Each event is validated individually.
  router.post('/events', requireApiKey(config), async (req, res) => {
    const { events } = parse(batchSchema, req.body);
    const parsed = events.map((e, i) => {
      const r = reportEventSchema.safeParse(e);
      if (!r.success) throw badRequest(`events[${i}] is invalid`, r.error.issues.map((x) => ({ path: x.path.join('.'), message: x.message })));
      return r.data;
    });
    const result = await ingest(parsed, { source: 'collector', actor: req.user.email });
    res.status(202).json(result);
  });

  // Real-user monitoring beacon from the React app: dashboard route load time.
  // Per signed-in user (not per IP): one person can't flood the channel from several tabs or proxies.
  const rumLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    keyGenerator: (req) => `rum:${req.user.email}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: () => {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many RUM beacons');
    },
  });
  router.post('/rum', userAuth, rumLimiter, async (req, res) => {
    const body = parse(rumSchema, req.body);
    const result = await ingest([{ type: 'client.load', ...body }], { source: 'rum', actor: req.user.email });
    res.status(202).json(result);
  });

  router.get('/recent', userAuth, requirePermission(pool, 'health:read'), async (req, res) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(30) }), req.query);
    const { rows } = await pool.query(
      `SELECT event_id, received_at, source, event_type, report_id, snapshot_seq, avg_load_time_sec, refresh_status
         FROM app.telemetry_events ORDER BY event_id DESC LIMIT $1`,
      [limit],
    );
    res.json({ events: rows });
  });

  router.get('/replay', userAuth, requirePermission(pool, 'health:read'), (_req, res) => {
    res.json(replayer.status());
  });

  const control = [userAuth, requirePermission(pool, 'replay:control')];
  router.post('/replay/start', ...control, async (req, res) => {
    const status = await replayer.start();
    await audit(pool, { req, action: 'replay.start' });
    res.json(status);
  });
  router.post('/replay/stop', ...control, async (req, res) => {
    const status = replayer.stop();
    await audit(pool, { req, action: 'replay.stop' });
    res.json(status);
  });
  router.post('/replay/reset', ...control, async (req, res) => {
    const { clearAlerts } = parse(z.object({ clearAlerts: z.boolean().default(true) }), req.body ?? {});
    const status = await replayer.reset({ clearAlerts });
    await audit(pool, { req, action: 'replay.reset', detail: { clearAlerts } });
    res.json(status);
  });
  router.post('/replay/config', ...control, async (req, res) => {
    const body = parse(configSchema, req.body ?? {});
    const status = replayer.configure(body);
    await audit(pool, { req, action: 'replay.configure', detail: body });
    res.json(status);
  });

  return router;
}
