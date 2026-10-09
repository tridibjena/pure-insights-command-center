import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { REPO_ROOT } from './config.js';
import { HttpError } from './errors.js';
import { authenticate, csrfGuard, requirePermission } from './auth/middleware.js';
import { adminRouter } from './routes/admin.js';
import { alertsRouter } from './routes/alerts.js';
import { authRouter } from './routes/auth.js';
import { costsRouter } from './routes/costs.js';
import { dashboardRouter } from './routes/dashboard.js';
import { dataQualityRouter } from './routes/dataQuality.js';
import { healthRouter } from './routes/health.js';
import { orphansRouter } from './routes/orphans.js';
import { reportsRouter } from './routes/reports.js';
import { telemetryRouter } from './routes/telemetry.js';

// Every API mount, with the permission guarding it ('public' / 'auth' / 'health' = handled in-router).
export function routeMounts(deps) {
  return [
    { prefix: '/api/auth', router: authRouter(deps), guard: 'public' },
    { prefix: '/api/health', router: healthRouter(deps), guard: 'health' },
    { prefix: '/api/telemetry', router: telemetryRouter(deps), guard: 'public' },
    { prefix: '/api/dashboard', router: dashboardRouter(deps), guard: 'health:read' },
    { prefix: '/api/reports', router: reportsRouter(deps), guard: 'reports:read' },
    { prefix: '/api/orphans', router: orphansRouter(deps), guard: 'orphans:read' },
    { prefix: '/api/alerts', router: alertsRouter(deps), guard: 'alerts:read' },
    { prefix: '/api/costs', router: costsRouter(deps), guard: 'costs:read' },
    { prefix: '/api/data-quality', router: dataQualityRouter(deps), guard: 'dq:read' },
    { prefix: '/api/admin', router: adminRouter(deps), guard: 'auth' },
  ];
}

export function createApp({ pool, config, hub, ingest, replayer, metrics, logger }) {
  const app = express();
  const deps = { pool, config, hub, ingest, replayer, metrics };
  const auth = authenticate({ pool, config });
  const need = (permission) => requirePermission(pool, permission);

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          styleSrc: ["'self'", "'unsafe-inline'"], // chart libraries set inline style attributes
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(metrics.middleware);
  // CSRF header check for browser (cookie) requests; API-key collectors are exempt.
  app.use('/api', (req, res, next) => (req.get('X-API-Key') ? next() : csrfGuard(req, res, next)));

  const publicHealth = (req, res, next) => (req.path === '/' ? next() : auth(req, res, next));
  for (const { prefix, router, guard } of routeMounts(deps)) {
    const chain = guard === 'public' ? [] : guard === 'health' ? [publicHealth] : guard === 'auth' ? [auth] : [auth, need(guard)];
    app.use(prefix, ...chain, router);
  }
  app.use('/api', (req) => {
    throw new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`);
  });

  // Production: serve the built React app from the same origin.
  const dist = path.join(REPO_ROOT, 'client', 'dist');
  if (config.isProduction && fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
    }
    req.log?.error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } });
  });

  return app;
}
