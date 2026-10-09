import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig, REPO_ROOT } from '../src/config.js';
import { createServer } from '../src/server.js';
import { seedUsers } from '../scripts/seedUsers.js';

export const PASSWORD = 'Test-Password-123';
export const API_KEY = 'test-telemetry-key-0001';
export const USERS = {
  admin: 'admin@pureinsights.local',
  sre: 'sre@pureinsights.local',
  finops: 'finops@pureinsights.local',
  owner: 'user_7@company.com',
};

let prepared = false;

/** Make sure the test database has the cleaned data, cost views and demo users. */
async function prepareDatabase(pool) {
  if (prepared) return;
  const { rows } = await pool
    .query(`SELECT (SELECT count(*) FROM app.reports)::int AS n,
                   to_regclass('cost.v_reconciliation_checks') IS NOT NULL AS has_views`)
    .catch(() => ({ rows: [{ n: 0, has_views: false }] }));
  if (rows[0].n !== 100 || !rows[0].has_views) {
    execFileSync(path.join(REPO_ROOT, 'pipeline', '.venv', 'bin', 'python'), ['-m', 'pic_pipeline.cli', 'data', '--test'], {
      cwd: path.join(REPO_ROOT, 'pipeline'),
      stdio: 'ignore',
    });
  }
  await seedUsers(pool, PASSWORD);
  prepared = true;
}

export async function startTestServer(overrides = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    TELEMETRY_API_KEY: API_KEY,
    LOGIN_RATE_LIMIT: '1000',
    REPLAY_AUTOSTART: 'false',
    ...overrides,
  });
  const ctx = createServer(config);
  await prepareDatabase(ctx.pool);
  await new Promise((resolve) => ctx.server.listen(0, resolve));
  const { port } = ctx.server.address();
  ctx.baseUrl = `http://127.0.0.1:${port}`;
  ctx.wsUrl = `ws://127.0.0.1:${port}/ws`;
  return ctx;
}

export async function clearAlerts(pool) {
  await pool.query('TRUNCATE app.alert_events, app.alerts, app.telemetry_events RESTART IDENTITY');
}

export async function login(ctx, who, password = PASSWORD) {
  const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: JSON.stringify({ email: USERS[who] ?? who, password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? null;
  return { res, cookie, body: await res.json() };
}

/** fetch wrapper that sends the session cookie and the CSRF header. */
export function client(ctx, cookie) {
  return async (method, url, body) => {
    const res = await fetch(`${ctx.baseUrl}${url}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        'x-requested-with': 'XMLHttpRequest',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

export async function postTelemetry(ctx, events, key = API_KEY) {
  const res = await fetch(`${ctx.baseUrl}/api/telemetry/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ events }),
  });
  return { status: res.status, body: await res.json() };
}

/** Open an authenticated socket and collect messages. */
export function openSocket(ctx, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ctx.wsUrl, { headers: cookie ? { cookie } : {} });
    const messages = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      for (const w of [...waiters]) {
        if (w.match(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
    ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error('upgrade rejected'), { status: res.statusCode })));
    ws.on('error', reject);
    ws.on('open', () => {
      const api = {
        ws,
        messages,
        next(match, timeoutMs = 3000) {
          const existing = messages.find(match);
          if (existing) {
            messages.splice(messages.indexOf(existing), 1);
            return Promise.resolve(existing);
          }
          return new Promise((res, rej) => {
            const w = { match, resolve: (m) => { clearTimeout(timer); messages.splice(messages.indexOf(m), 1); res(m); } };
            const timer = setTimeout(() => {
              waiters.splice(waiters.indexOf(w), 1);
              rej(new Error('timed out waiting for websocket message'));
            }, timeoutMs);
            waiters.push(w);
          });
        },
        close: () => ws.close(),
      };
      resolve(api);
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
