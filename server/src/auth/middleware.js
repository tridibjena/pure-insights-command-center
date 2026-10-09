import crypto from 'node:crypto';
import { HttpError } from '../errors.js';
import { audit } from '../audit.js';
import { can, isOwnerScoped, permissionsFor } from './permissions.js';
import { SESSION_COOKIE, verifySession } from './session.js';

export async function loadUser(pool, userId) {
  const { rows } = await pool.query(
    `SELECT user_id, email, display_name, role, owner_email, is_active
     FROM app.users WHERE user_id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  return { ...user, permissions: permissionsFor(user.role), ownerScoped: isOwnerScoped(user.role) };
}

// Resolve the session cookie into req.user (or 401). The user row is re-read on every
// request so deactivating an account or changing a role takes effect immediately.
export function authenticate({ pool, config }) {
  return async (req, _res, next) => {
    const claims = verifySession(req.cookies?.[SESSION_COOKIE], config.auth);
    const user = claims && (await loadUser(pool, Number(claims.sub)));
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
    req.user = user;
    next();
  };
}

export function requirePermission(pool, permission) {
  return async (req, _res, next) => {
    if (!can(req.user?.role, permission)) {
      await audit(pool, { req, action: 'access.denied', target: `${req.method} ${req.originalUrl}`, outcome: 'DENIED', detail: { permission } });
      throw new HttpError(403, 'FORBIDDEN', `Missing permission: ${permission}`);
    }
    next();
  };
}

// Defence in depth against CSRF on top of SameSite=Strict: browsers cannot attach this
// header cross-site without a CORS preflight, which our allowlist rejects.
export function csrfGuard(req, _res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!safe && req.get('X-Requested-With') !== 'XMLHttpRequest') {
    throw new HttpError(403, 'CSRF_CHECK_FAILED', 'Missing X-Requested-With header');
  }
  next();
}

// Machine-to-machine telemetry ingestion: SERVICE role via X-API-Key.
export function requireApiKey(config) {
  const expected = Buffer.from(config.auth.telemetryApiKey);
  return (req, _res, next) => {
    const given = Buffer.from(req.get('X-API-Key') ?? '');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw new HttpError(401, 'INVALID_API_KEY', 'A valid X-API-Key is required');
    }
    req.user = { email: 'service:telemetry-collector', role: 'SERVICE', permissions: permissionsFor('SERVICE') };
    next();
  };
}

// SQL fragment + params restricting rows to the caller's reports when they are owner-scoped.
export function ownerScope(user, column = 'report_id', paramIndex = 1) {
  if (!user.ownerScoped) return { clause: 'TRUE', params: [] };
  return {
    clause: `${column} IN (SELECT report_id FROM app.v_report_current WHERE owner_email = $${paramIndex})`,
    params: [user.owner_email],
  };
}
