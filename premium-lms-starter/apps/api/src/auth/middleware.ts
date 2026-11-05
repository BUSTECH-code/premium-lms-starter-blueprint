import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getUserAccess, findSessionById, type Permission, type Role } from '@lms/db';
import type { Env } from '../config/env.js';
import type { DbClient } from '@lms/db';
import { errors } from '../lib/errors.js';
import { ACCESS_COOKIE_NAME } from './cookies.js';
import { verifyAccessToken } from './tokens.js';
import type { AuthContext } from './context.js';

function extractAccessToken(req: Request): string | null {
  const cookie = req.cookies?.[ACCESS_COOKIE_NAME];
  if (typeof cookie === 'string' && cookie.length > 0) return cookie;

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return null;
}

async function loadContext(
  env: Env,
  db: DbClient,
  req: Request,
): Promise<AuthContext> {
  const token = extractAccessToken(req);
  if (!token) {
    throw errors.unauthorized('authentication_required', 'Authentication required.');
  }

  let claims;
  try {
    claims = await verifyAccessToken(token, env.auth.jwtSecret);
  } catch {
    throw errors.unauthorized('invalid_token', 'Your session is not valid. Please sign in again.');
  }

  const session = await findSessionById(db, claims.sid);
  if (!session || session.user_id !== claims.sub) {
    throw errors.unauthorized('invalid_session', 'Your session is not valid. Please sign in again.');
  }
  if (session.revoked_at !== null) {
    throw errors.unauthorized('session_revoked', 'Your session has been ended. Please sign in again.');
  }
  if (session.expires_at.getTime() <= Date.now()) {
    throw errors.unauthorized('session_expired', 'Your session has expired. Please sign in again.');
  }

  const access = await getUserAccess(db, claims.sub);
  if (!access) {
    throw errors.unauthorized('invalid_session', 'Your session is not valid. Please sign in again.');
  }
  if (access.user.status === 'suspended') {
    throw errors.forbidden('account_suspended', 'This account has been suspended.');
  }

  return { user: access.user, roles: access.roles, permissions: access.permissions, sessionId: session.id };
}

/** Require a valid session; sets `req.auth`. */
export function authenticate(env: Env, db: DbClient): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.auth = await loadContext(env, db, req);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Like authenticate, but leaves `req.auth` undefined instead of failing —
 * used by logout so the endpoint stays idempotent.
 */
export function optionalAuthenticate(env: Env, db: DbClient): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (extractAccessToken(req)) {
        req.auth = await loadContext(env, db, req);
      }
    } catch {
      // Optional auth never fails; the route decides what an anonymous call means.
    }
    next();
  };
}

/** Deny-by-default permission guard (server-side; UI hiding is never enough). */
export function requirePermission(permission: Permission): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(errors.unauthorized());
      return;
    }
    if (!req.auth.permissions.includes(permission)) {
      next(
        errors.forbidden(
          'permission_denied',
          'You do not have permission to perform this action.',
        ),
      );
      return;
    }
    next();
  };
}

export function requireRole(role: Role): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(errors.unauthorized());
      return;
    }
    if (!req.auth.roles.includes(role)) {
      next(errors.forbidden('role_required', 'You do not have permission to perform this action.'));
      return;
    }
    next();
  };
}
