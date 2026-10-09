import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { audit } from '../audit.js';
import { HttpError, parse } from '../errors.js';
import { authenticate } from '../auth/middleware.js';
import { permissionsFor, isOwnerScoped } from '../auth/permissions.js';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../auth/session.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

// Compared against when the e-mail is unknown, so response time does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 12);

export function publicUser(u) {
  return {
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    ownerEmail: u.owner_email,
    ownerScoped: isOwnerScoped(u.role),
    permissions: permissionsFor(u.role),
  };
}

export function authRouter({ pool, config }) {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.auth.loginRateLimit,
    skipSuccessfulRequests: true, // only failed attempts count towards the brute-force limit
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: () => {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again in 15 minutes.');
    },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { rows } = await pool.query(
      `SELECT user_id, email, display_name, password_hash, role, owner_email, is_active FROM app.users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.is_active) {
      await audit(pool, { req, actor: { email }, action: 'auth.login', outcome: 'FAILED' });
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    await pool.query('UPDATE app.users SET last_login_at = now() WHERE user_id = $1', [user.user_id]);
    res.cookie(SESSION_COOKIE, signSession(user, config.auth), sessionCookieOptions(config));
    await audit(pool, { req, actor: user, action: 'auth.login' });
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    const { maxAge: _maxAge, ...opts } = sessionCookieOptions(config);
    res.clearCookie(SESSION_COOKIE, opts);
    res.status(204).end();
  });

  router.get('/me', authenticate({ pool, config }), (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  return router;
}
