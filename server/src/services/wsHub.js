// WebSocket hub (path /ws). Authenticates the upgrade with the same httpOnly session
// cookie as the REST API, checks Origin, and filters every message per connection by
// permission and — for REPORT_OWNER — by the reports the user currently owns.
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { can } from '../auth/permissions.js';
import { loadUser } from '../auth/middleware.js';
import { tokenFromCookieHeader, verifySession } from '../auth/session.js';

const HEARTBEAT_MS = 30_000;
// Messages an owner-scoped user may receive even though they carry no report id.
const UNSCOPED_TYPES = new Set(['session.ready', 'system.heartbeat', 'alerts.cleared']);

export function envelope(type, data) {
  return { type, id: crypto.randomUUID(), ts: new Date().toISOString(), data };
}

function rejectUpgrade(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createWsHub({ server, pool, config, logger }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Map(); // ws -> { user, owned: Set<string> | null, alive }

  async function ownedReports(user) {
    if (!user.ownerScoped) return null;
    const { rows } = await pool.query('SELECT report_id FROM app.v_report_current WHERE owner_email = $1', [user.owner_email]);
    return new Set(rows.map((r) => r.report_id));
  }

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser clients (tests, CLI tools) still need a valid session cookie
    if (config.clientOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  server.on('upgrade', async (req, socket, head) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
      if (!originAllowed(req)) return rejectUpgrade(socket, 403, 'Forbidden');
      const claims = verifySession(tokenFromCookieHeader(req.headers.cookie), config.auth);
      const user = claims && (await loadUser(pool, Number(claims.sub)));
      if (!user) return rejectUpgrade(socket, 401, 'Unauthorized');
      if (!can(user.role, 'alerts:read')) return rejectUpgrade(socket, 403, 'Forbidden');
      const owned = await ownedReports(user);
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.set(ws, { user, owned, alive: true });
        ws.on('pong', () => {
          const c = clients.get(ws);
          if (c) c.alive = true;
        });
        ws.on('message', () => {}); // server-push only; inbound messages are ignored
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
        send(ws, envelope('session.ready', { email: user.email, role: user.role, scopedReports: owned ? [...owned] : null }));
      });
    } catch (err) {
      logger.error({ err }, 'websocket upgrade failed');
      rejectUpgrade(socket, 500, 'Internal Server Error');
    }
  });

  function send(ws, message) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  function allowed(ctx, type, { reportId, permission }) {
    if (permission && !can(ctx.user.role, permission)) return false;
    if (!ctx.owned) return true;
    if (reportId) return ctx.owned.has(reportId);
    return UNSCOPED_TYPES.has(type);
  }

  /** Send to every connection allowed to see it. */
  function broadcast(type, data, { reportId = null, permission = 'alerts:read' } = {}) {
    const message = envelope(type, data);
    let delivered = 0;
    for (const [ws, ctx] of clients) {
      if (allowed(ctx, type, { reportId, permission })) {
        send(ws, message);
        delivered += 1;
      }
    }
    return delivered;
  }

  async function refreshScopes() {
    for (const ctx of clients.values()) {
      if (ctx.user.ownerScoped) ctx.owned = await ownedReports(ctx.user);
    }
  }

  const heartbeat = setInterval(() => {
    for (const [ws, ctx] of clients) {
      if (!ctx.alive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ctx.alive = false;
      ws.ping();
    }
    broadcast('system.heartbeat', { clients: clients.size }, { permission: null });
  }, HEARTBEAT_MS);
  const scopeRefresh = setInterval(() => refreshScopes().catch((err) => logger.error({ err }, 'scope refresh failed')), 60_000);
  heartbeat.unref();
  scopeRefresh.unref();

  return {
    broadcast,
    refreshScopes,
    stats() {
      const byRole = {};
      for (const { user } of clients.values()) byRole[user.role] = (byRole[user.role] ?? 0) + 1;
      return { clients: clients.size, byRole };
    },
    close() {
      clearInterval(heartbeat);
      clearInterval(scopeRefresh);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}
