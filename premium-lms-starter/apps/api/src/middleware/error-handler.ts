import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, errors, isAppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: 'Resource not found.' },
  });
}

function zodToAppError(error: ZodError): AppError {
  return errors.badRequest(
    'Validation failed.',
    error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  );
}

/**
 * Final error handler. Safe error contract: no stacks, secrets or internal
 * details ever leave the server; everything unexpected is logged with context.
 */
export function errorHandler(logger: Logger): (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof ZodError) {
      const appError = zodToAppError(err);
      res.status(appError.status).json({
        error: { code: appError.code, message: appError.message, details: appError.details },
      });
      return;
    }

    if (isAppError(err)) {
      const level = err.status >= 500 ? 'error' : 'warn';
      logger[level](
        { status: err.status, code: err.code, path: req.path, method: req.method },
        err.message,
      );
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      });
      return;
    }

    // Express body-parser JSON syntax errors
    const maybeParseError = err as { type?: string; status?: number; statusCode?: number };
    if (maybeParseError?.type === 'entity.parse.failed') {
      res.status(400).json({
        error: { code: 'bad_json', message: 'Request body is not valid JSON.' },
      });
      return;
    }

    logger.error({ err, path: req.path, method: req.method }, 'Unhandled request error');
    res.status(500).json({
      error: { code: 'internal_error', message: 'An unexpected error occurred.' },
    });
  };
}
