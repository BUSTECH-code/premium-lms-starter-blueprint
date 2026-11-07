import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Env } from '../config/env.js';
import { errors } from '../lib/errors.js';

/** Baseline security headers for API responses. */
export function securityHeaders(env: Env): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cache-Control', 'no-store');
    if (env.isProductionLike) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}

/**
 * Minimal CORS support for credentialled cross-origin requests from the
 * configured browser origins. In the standard dev/preview setup the web app
 * calls the API through the Vite proxy (same-origin), so CORS rarely applies;
 * it exists for deployments that serve web and API on different origins.
 */
export function cors(env: Env): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');

    if (origin && env.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * CSRF defence-in-depth for state-changing requests.
 *
 * Primary control: SameSite cookie attributes (strict/lax) — the browser will
 * not attach our cookies to cross-site mutations. This middleware adds an
 * Origin check on top:
 *  - no Origin header → non-browser client → allowed (it has no victim cookies);
 *  - Origin in WEB_ORIGIN → allowed;
 *  - Origin host matches X-Forwarded-Host → the request arrived through our
 *    own reverse proxy/dev-server (attackers cannot make a victim's browser
 *    send forged X-Forwarded-* headers on simple requests, and custom headers
 *    are blocked by CORS preflight).
 * Anything else is rejected with 403.
 */
const PROVIDER_WEBHOOK_PATHS = new Set([
  '/api/checkout/webhook',
  '/api/webhooks/payments',
]);

export function originCheck(env: Env): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      next();
      return;
    }

    // Provider callbacks are not browser session requests: their authenticity
    // comes from an HMAC signature. Some gateways send a non-web Origin header,
    // which must not turn a genuinely signed webhook into a CSRF rejection.
    if (PROVIDER_WEBHOOK_PATHS.has(req.path)) {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    if (env.allowedOrigins.includes(origin)) {
      next();
      return;
    }

    const forwardedHostHeader = req.headers['x-forwarded-host'];
    if (typeof forwardedHostHeader === 'string') {
      const forwardedHost = forwardedHostHeader.split(',')[0]?.trim();
      try {
        if (forwardedHost && new URL(origin).host === forwardedHost) {
          next();
          return;
        }
      } catch {
        // fall through to rejection
      }
    }

    next(errors.forbidden('origin_not_allowed', 'Request origin is not allowed.'));
  };
}
