import type { Response } from 'express';
import type { Env } from '../config/env.js';

/**
 * Secure cookie configuration.
 * - httpOnly: never readable from JavaScript (tokens stay out of the browser).
 * - sameSite: 'strict' for the refresh cookie (only ever sent to the refresh
 *   endpoint), 'lax' for the access cookie.
 * - secure: HTTPS-only in staging/production (env.auth.cookieSecure).
 * - scoped paths: the refresh cookie is only sent to its endpoint.
 */
export const ACCESS_COOKIE_NAME = 'lms_at';
export const REFRESH_COOKIE_NAME = 'lms_rt';
export const REFRESH_COOKIE_PATH = '/api/auth/refresh';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export function setAuthCookies(
  res: Response,
  tokens: TokenPair,
  env: Env,
  ttlSeconds: { access: number; refresh: number },
): void {
  const secure = env.auth.cookieSecure;
  const now = Date.now();

  res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: new Date(now + ttlSeconds.access * 1000),
  });

  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: new Date(now + ttlSeconds.refresh * 1000),
  });
}

export function clearAuthCookies(res: Response, env: Env): void {
  const secure = env.auth.cookieSecure;
  const options = { httpOnly: true, secure, sameSite: 'lax' as const };

  res.clearCookie(ACCESS_COOKIE_NAME, { ...options, path: '/' });
  res.clearCookie(REFRESH_COOKIE_NAME, { ...options, path: REFRESH_COOKIE_PATH, sameSite: 'strict' as const });
}
