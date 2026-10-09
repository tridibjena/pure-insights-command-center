// Validated runtime configuration, read once from the repository-level .env.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  PGHOST: z.string().default('localhost'),
  PGPORT: z.coerce.number().int().default(5433),
  PGUSER: z.string().default('pic'),
  PGPASSWORD: z.string().default(''),
  PGDATABASE: z.string().default('pure_insights'),
  PGDATABASE_TEST: z.string().default('pure_insights_test'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
  TELEMETRY_API_KEY: z.string().min(12),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  LATENCY_ALERT_THRESHOLD_SEC: z.coerce.number().positive().default(15),
  LATENCY_HIGH_ABOVE_SEC: z.coerce.number().positive().default(30),
  LATENCY_CRITICAL_ABOVE_SEC: z.coerce.number().positive().default(45),
  LATENCY_INVALID_ABOVE_SEC: z.coerce.number().positive().default(300),
  REPLAY_AUTOSTART: bool,
  REPLAY_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().min(500).default(10000),
  REPLAY_LOOP: bool,
  CREDIT_PRICE_USD: z.coerce.number().positive().default(3),
  LOG_LEVEL: z.string().optional(),
});

export function loadConfig(overrides = {}) {
  const env = schema.parse({ ...process.env, ...overrides });
  const isTest = env.NODE_ENV === 'test';
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.API_PORT,
    clientOrigins: env.CLIENT_ORIGIN.split(',').map((s) => s.trim()),
    db: {
      host: env.PGHOST,
      port: env.PGPORT,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      database: isTest ? env.PGDATABASE_TEST : env.PGDATABASE,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      sessionTtlHours: env.SESSION_TTL_HOURS,
      telemetryApiKey: env.TELEMETRY_API_KEY,
      loginRateLimit: env.LOGIN_RATE_LIMIT,
    },
    thresholds: {
      // Alert threshold from the brief: latency strictly greater than this many seconds.
      latencyAlertSec: env.LATENCY_ALERT_THRESHOLD_SEC,
      // Display severity tiers above the threshold (configurable, not from the brief).
      latencyHighAboveSec: env.LATENCY_HIGH_ABOVE_SEC,
      latencyCriticalAboveSec: env.LATENCY_CRITICAL_ABOVE_SEC,
      latencyInvalidAboveSec: env.LATENCY_INVALID_ABOVE_SEC,
    },
    replay: {
      autostart: env.REPLAY_AUTOSTART,
      snapshotIntervalMs: env.REPLAY_SNAPSHOT_INTERVAL_MS,
      loop: env.REPLAY_LOOP,
    },
    creditPriceUsd: env.CREDIT_PRICE_USD,
    logLevel: env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
  };
}
