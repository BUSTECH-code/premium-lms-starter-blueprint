import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import type { DbClient } from '@lms/db';
import { createAdminRouter } from './admin/routes.js';
import { createAuthRouter } from './auth/routes.js';
import { SlidingWindowRateLimiter } from './auth/rate-limit.js';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { cors, originCheck, securityHeaders } from './middleware/security.js';

export interface AppDependencies {
  env: Env;
  db: DbClient;
  logger: Logger;
}

/**
 * Express application factory. Dependencies are injected so tests can run the
 * full middleware/router stack against an in-memory database.
 */
export function createApp({ env, db, logger }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);

  app.use(securityHeaders(env));
  app.use(cors(env));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(requestLogger(logger));
  app.use(originCheck(env));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', environment: env.nodeEnv });
  });

  const limiters = {
    login: new SlidingWindowRateLimiter(
      env.rateLimit.login.maxAttempts,
      env.rateLimit.login.windowSeconds,
    ),
    loginPerIp: new SlidingWindowRateLimiter(
      env.rateLimit.loginPerIp.maxAttempts,
      env.rateLimit.loginPerIp.windowSeconds,
    ),
    register: new SlidingWindowRateLimiter(
      env.rateLimit.register.maxAttempts,
      env.rateLimit.register.windowSeconds,
    ),
  };

  app.use('/api/auth', createAuthRouter({ env, db, logger, limiters }));
  app.use('/api/admin', createAdminRouter({ env, db, logger }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
