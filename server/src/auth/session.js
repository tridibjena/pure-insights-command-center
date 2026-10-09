// Session = signed JWT (HS256) carried in an httpOnly, SameSite=Strict cookie.
// The token is never readable by JavaScript in the browser.
import jwt from 'jsonwebtoken';
import { parseCookie } from 'cookie';

export const SESSION_COOKIE = 'pic_session';

export function signSession(user, auth) {
  return jwt.sign({ sub: String(user.user_id), role: user.role }, auth.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${auth.sessionTtlHours}h`,
    issuer: 'pure-insights-command-center',
  });
}

export function verifySession(token, auth) {
  try {
    return jwt.verify(token, auth.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'pure-insights-command-center',
    });
  } catch {
    return null;
  }
}

export function sessionCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/',
    maxAge: config.auth.sessionTtlHours * 3600 * 1000,
  };
}

export function tokenFromCookieHeader(header) {
  if (!header) return null;
  return parseCookie(header)[SESSION_COOKIE] ?? null;
}
