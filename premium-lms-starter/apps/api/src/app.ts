import cookieParser from 'cookie-parser';
import express, { type Express, type Request } from 'express';
import type { DbClient } from '@lms/db';
import { createAdminRouter } from './admin/routes.js';
import { createAuthRouter } from './auth/routes.js';
import { SlidingWindowRateLimiter } from './auth/rate-limit.js';
import { createCatalogRouter } from './catalog/routes.js';
import { createCommerceRouter } from './commerce/routes.js';
import type { Env } from './config/env.js';
import { createLearningRouter } from './learning/routes.js';
import type { Logger } from './lib/logger.js';
import { createMediaRouter } from './media/routes.js';
import { createMediaProvider } from './media/provider.js';
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
  // Capture the exact raw bytes for webhook HMAC verification while still
  // exposing a parsed body to routes.
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
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
    checkout: new SlidingWindowRateLimiter(
      env.rateLimit.checkout.maxAttempts,
      env.rateLimit.checkout.windowSeconds,
    ),
  };

  app.use('/api/auth', createAuthRouter({ env, db, logger, limiters }));
  app.use('/api/admin', createAdminRouter({ env, db, logger }));
  app.use('/api', createCatalogRouter({ env, db }));
  app.use(
    '/api',
    createCommerceRouter({ env, db, logger, checkoutLimiter: limiters.checkout }),
  );
  app.use('/api', createLearningRouter({ env, db }));
  app.use('/api', createMediaRouter({ env, db, provider: createMediaProvider() }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
