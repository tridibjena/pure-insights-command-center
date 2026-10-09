// Wires the HTTP server, WebSocket hub, telemetry pipeline and replay together.
import http from 'node:http';
import pino from 'pino';
import { createApp } from './app.js';
import { createPool } from './db.js';
import { createApiMetrics } from './services/apiMetrics.js';
import { createTelemetryIngest } from './services/telemetryIngest.js';
import { createTelemetryReplayer } from './services/telemetryReplayer.js';
import { createWsHub } from './services/wsHub.js';

export function createServer(config) {
  const logger = pino({ level: config.logLevel });
  const pool = createPool(config.db);
  const server = http.createServer();
  const hub = createWsHub({ server, pool, config, logger });
  const { ingest } = createTelemetryIngest({ pool, hub, thresholds: config.thresholds, logger });
  const replayer = createTelemetryReplayer({ pool, ingest, hub, config, logger });
  const metrics = createApiMetrics();
  const app = createApp({ pool, config, hub, ingest, replayer, metrics, logger });
  server.on('request', app);

  async function close() {
    replayer.shutdown();
    hub.close();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }

  return { app, server, pool, hub, ingest, replayer, logger, close };
}
