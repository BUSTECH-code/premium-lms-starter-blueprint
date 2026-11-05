import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { errors } from '../lib/errors.js';

/**
 * Anti-hotlink / anti-embedding checks for media GET and HEAD requests.
 *
 * This raises the effort required for casual hotlinking; it is deliberately
 * not described as DRM or absolute copying prevention. Signed URLs, auth
 * cookies, grant/session binding and entitlement re-checks remain mandatory.
 */

function trustedHosts(req: Request): string[] {
  const hosts: string[] = [];
  const forwarded = req.headers['x-forwarded-host'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) hosts.push(first);
  }
  if (typeof req.headers.host === 'string' && req.headers.host.trim()) {
    hosts.push(req.headers.host.trim());
  }
  return hosts;
}

function originHost(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.host;
  } catch {
    return null;
  }
}

function isTrustedOrigin(value: string, req: Request, env: Env): boolean {
  try {
    const url = new URL(value);
    if (env.allowedOrigins.includes(url.origin)) return true;
    return trustedHosts(req).includes(url.host);
  } catch {
    return false;
  }
}

export function mediaResponseHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  // same-site allows an approved web/API split origin while still blocking
  // cross-site embedding; explicit Origin/Referer checks provide a second gate.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Vary', 'Origin, Referer, Sec-Fetch-Site, Sec-Fetch-Dest');
}

export function assertAllowedMediaContext(req: Request, env: Env): void {
  const blocked = () =>
    errors.forbidden(
      'media_hotlink_blocked',
      'This media link may only be used from the academy application.',
    );

  const destination = req.headers['sec-fetch-dest'];
  if (
    typeof destination === 'string' &&
    ['image', 'iframe', 'script', 'object', 'embed'].includes(destination)
  ) {
    throw blocked();
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const refererOrigin = typeof referer === 'string' ? originHost(referer) : null;
  const trusted =
    (typeof origin === 'string' && isTrustedOrigin(origin, req, env)) ||
    (typeof referer === 'string' && isTrustedOrigin(referer, req, env));
  const site = req.headers['sec-fetch-site'];

  if (typeof site === 'string' && site === 'cross-site' && !trusted) {
    throw blocked();
  }
  if (typeof origin === 'string' && !isTrustedOrigin(origin, req, env)) {
    throw blocked();
  }
  if (
    typeof referer === 'string' &&
    (refererOrigin === null || !isTrustedOrigin(referer, req, env))
  ) {
    throw blocked();
  }
}
