import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  DEFAULT_ROLE,
  createUser,
  findUserByEmail,
  getUserAccess,
  sessions as sessionRepo,
  type DbClient,
  type UserWithAccess,
} from '@lms/db';
import type { Env } from '../config/env.js';
import { errors } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { validateBody } from '../middleware/validate.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword, verifyAgainstDummyHash, verifyPassword } from './passwords.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, clearAuthCookies, setAuthCookies } from './cookies.js';
import { rateLimit, type SlidingWindowRateLimiter } from './rate-limit.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens.js';
import { authenticate, optionalAuthenticate } from './middleware.js';

const emailSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.email('Enter a valid email address.'),
);

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120, 'Name is too long.'),
  email: emailSchema,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, 'Password is too long.'),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.').max(PASSWORD_MAX_LENGTH, 'Password is too long.'),
});

export interface AuthRouterDeps {
  env: Env;
  db: DbClient;
  logger: Logger;
  limiters: {
    login: SlidingWindowRateLimiter;
    loginPerIp: SlidingWindowRateLimiter;
    register: SlidingWindowRateLimiter;
  };
}

/** Safe public projection — never includes password hashes or internal columns. */
function publicUser(access: UserWithAccess) {
  return {
    id: access.user.id,
    email: access.user.email,
    name: access.user.name,
    status: access.user.status,
    roles: access.roles,
    permissions: access.permissions,
    createdAt: access.user.created_at,
  };
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { env, db, logger, limiters } = deps;
  const router = Router();

  const clientIp = (req: Request): string => req.ip ?? 'unknown';

  async function issueSession(req: Request, userId: string) {
    const refreshToken = generateRefreshToken();
    const session = await sessionRepo.createSession(db, {
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + env.auth.refreshTokenTtlSeconds * 1000),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ipAddress: req.ip ?? null,
    });
    const accessToken = await signAccessToken({
      secret: env.auth.jwtSecret,
      userId,
      sessionId: session.id,
      ttlSeconds: env.auth.accessTokenTtlSeconds,
    });
    return { accessToken, refreshToken };
  }

  // --------------------------------------------------------------------------
  // POST /api/auth/register
  // --------------------------------------------------------------------------
  router.post(
    '/register',
    rateLimit({
      limiter: limiters.register,
      keyOf: (req) => `register:${clientIp(req)}`,
      message: 'Too many registration attempts. Please try again later.',
    }),
    validateBody(registerSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { name, email, password } = req.body as z.infer<typeof registerSchema>;

        const existing = await findUserByEmail(db, email);
        if (existing) {
          throw errors.conflict('email_taken', 'An account with this email already exists.');
        }

        const passwordHash = await hashPassword(password);
        let userId: string;
        try {
          const user = await createUser(db, {
            email,
            passwordHash,
            name,
            roleKeys: [DEFAULT_ROLE],
          });
          userId = user.id;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === '23505') {
            throw errors.conflict('email_taken', 'An account with this email already exists.');
          }
          throw error;
        }

        const tokens = await issueSession(req, userId);
        setAuthCookies(res, tokens, env, {
          access: env.auth.accessTokenTtlSeconds,
          refresh: env.auth.refreshTokenTtlSeconds,
        });

        const access = await getUserAccess(db, userId);
        if (!access) throw errors.internal();
        logger.info(
          { event: 'user_registered', userId, requestId: req.id },
          'user registered',
        );
        res.status(201).json({ user: publicUser(access) });
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/auth/login
  // --------------------------------------------------------------------------
  router.post(
    '/login',
    validateBody(loginSchema),
    rateLimit({
      limiter: limiters.loginPerIp,
      keyOf: (req) => `login-ip:${clientIp(req)}`,
      message: 'Too many login attempts. Please try again later.',
    }),
    rateLimit({
      limiter: limiters.login,
      keyOf: (req) => {
        const email = (req.body as { email?: string } | undefined)?.email ?? '';
        return `login:${clientIp(req)}|${email}`;
      },
      message: 'Too many login attempts. Please try again later.',
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { email, password } = req.body as z.infer<typeof loginSchema>;
        const ipKey = `login-ip:${clientIp(req)}`;
        const emailKey = `login:${clientIp(req)}|${email}`;

        const user = await findUserByEmail(db, email);
        if (!user) {
          await verifyAgainstDummyHash(password); // timing equalisation
          logger.warn(
            { event: 'login_failed', reason: 'unknown_email', email, requestId: req.id },
            'login failed',
          );
          throw errors.unauthorized('invalid_credentials', 'Invalid email or password.');
        }

        const passwordOk = await verifyPassword(user.password_hash, password);
        if (!passwordOk) {
          logger.warn(
            { event: 'login_failed', reason: 'bad_password', userId: user.id, requestId: req.id },
            'login failed',
          );
          throw errors.unauthorized('invalid_credentials', 'Invalid email or password.');
        }

        if (user.status === 'suspended') {
          logger.warn(
            { event: 'login_blocked', reason: 'suspended', userId: user.id, requestId: req.id },
            'login blocked for suspended account',
          );
          throw errors.forbidden('account_suspended', 'This account has been suspended.');
        }

        limiters.login.reset(emailKey);
        limiters.loginPerIp.reset(ipKey);

        const tokens = await issueSession(req, user.id);
        setAuthCookies(res, tokens, env, {
          access: env.auth.accessTokenTtlSeconds,
          refresh: env.auth.refreshTokenTtlSeconds,
        });

        const access = await getUserAccess(db, user.id);
        if (!access) throw errors.internal();
        logger.info(
          { event: 'login_succeeded', userId: user.id, requestId: req.id },
          'login succeeded',
        );
        res.status(200).json({ user: publicUser(access) });
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/auth/refresh — rotates the refresh token on every use.
  // Reuse of a previously rotated token revokes the whole session.
  // --------------------------------------------------------------------------
  router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const presented = req.cookies?.[REFRESH_COOKIE_NAME];
      if (typeof presented !== 'string' || presented.length === 0) {
        throw errors.unauthorized('refresh_token_missing', 'No active session. Please sign in again.');
      }
      const presentedHash = hashRefreshToken(presented);

      const current = await sessionRepo.findSessionByRefreshHash(db, presentedHash);
      if (current) {
        if (current.revoked_at !== null) {
          clearAuthCookies(res, env);
          throw errors.unauthorized('session_revoked', 'Your session has been ended. Please sign in again.');
        }
        if (current.expires_at.getTime() <= Date.now()) {
          clearAuthCookies(res, env);
          throw errors.unauthorized('session_expired', 'Your session has expired. Please sign in again.');
        }

        const newRefreshToken = generateRefreshToken();
        const rotated = await sessionRepo.rotateSession(db, {
          sessionId: current.id,
          currentHash: presentedHash,
          newHash: hashRefreshToken(newRefreshToken),
        });
        if (!rotated) {
          // A concurrent request rotated this token first.
          clearAuthCookies(res, env);
          throw errors.unauthorized('invalid_session', 'Your session is not valid. Please sign in again.');
        }

        const access = await getUserAccess(db, current.user_id);
        if (!access) {
          clearAuthCookies(res, env);
          throw errors.unauthorized('invalid_session', 'Your session is not valid. Please sign in again.');
        }
        if (access.user.status === 'suspended') {
          await sessionRepo.revokeSession(db, { sessionId: current.id, reason: 'admin_revoked' });
          clearAuthCookies(res, env);
          throw errors.forbidden('account_suspended', 'This account has been suspended.');
        }

        const accessToken = await signAccessToken({
          secret: env.auth.jwtSecret,
          userId: current.user_id,
          sessionId: current.id,
          ttlSeconds: env.auth.accessTokenTtlSeconds,
        });
        setAuthCookies(res, { accessToken, refreshToken: newRefreshToken }, env, {
          access: env.auth.accessTokenTtlSeconds,
          refresh: env.auth.refreshTokenTtlSeconds,
        });
        logger.info(
          { event: 'session_refreshed', userId: current.user_id, sessionId: current.id, requestId: req.id },
          'session refreshed',
        );
        res.status(200).json({ user: publicUser(access) });
        return;
      }

      // Not the current token — was it a previously rotated one (replay)?
      const previous = await sessionRepo.findSessionByPreviousRefreshHash(db, presentedHash);
      if (previous && previous.revoked_at === null) {
        await sessionRepo.revokeSession(db, { sessionId: previous.id, reason: 'reuse_detected' });
        logger.warn(
          {
            event: 'refresh_token_reuse_detected',
            userId: previous.user_id,
            sessionId: previous.id,
            requestId: req.id,
          },
          'refresh token reuse detected — session revoked',
        );
        clearAuthCookies(res, env);
        throw errors.unauthorized(
          'refresh_token_reuse',
          'Your session has been ended for security reasons. Please sign in again.',
        );
      }

      clearAuthCookies(res, env);
      throw errors.unauthorized('invalid_refresh_token', 'Your session has ended. Please sign in again.');
    } catch (error) {
      next(error);
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/auth/logout — idempotent; revokes the session and clears cookies.
  // --------------------------------------------------------------------------
  router.post('/logout', optionalAuthenticate(env, db), async (req: Request, res: Response, next: NextFunction) => {
    try {
      let sessionId = req.auth?.sessionId;
      if (!sessionId) {
        const presented = req.cookies?.[REFRESH_COOKIE_NAME];
        if (typeof presented === 'string' && presented.length > 0) {
          const session = await sessionRepo.findSessionByRefreshHash(db, hashRefreshToken(presented));
          if (session && session.revoked_at === null) sessionId = session.id;
        }
      }
      if (sessionId) {
        const revoked = await sessionRepo.revokeSession(db, { sessionId, reason: 'logout' });
        if (revoked) {
          logger.info(
            { event: 'logout', userId: req.auth?.user.id, sessionId, requestId: req.id },
            'session revoked on logout',
          );
        }
      }
      clearAuthCookies(res, env);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/auth/me
  // --------------------------------------------------------------------------
  router.get('/me', authenticate(env, db), (req: Request, res: Response) => {
    res.json({ user: publicUser(req.auth!) });
  });

  return router;
}
