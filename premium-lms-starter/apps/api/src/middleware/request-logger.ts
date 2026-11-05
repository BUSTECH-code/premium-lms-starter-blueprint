import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from '../lib/logger.js';

/** Assigns a correlation id and logs one structured line per finished request. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    req.id = randomUUID();
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](
        {
          requestId: req.id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          userId: req.auth?.user.id,
        },
        'request completed',
      );
    });

    next();
  };
}
