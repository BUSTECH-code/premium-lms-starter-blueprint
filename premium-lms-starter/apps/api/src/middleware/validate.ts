import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { errors } from '../lib/errors.js';

/**
 * Server-side input validation. Client-side validation is never trusted —
 * every request body/query is validated at this boundary (security requirement:
 * server-side input validation).
 */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(result.error);
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(result.error);
      return;
    }
    // Attach the parsed value without destroying req.query for logging.
    (req as Request & { validatedQuery?: T }).validatedQuery = result.data;
    next();
  };
}

export function getValidatedQuery<T>(req: Request): T {
  const value = (req as Request & { validatedQuery?: T }).validatedQuery;
  if (value === undefined) {
    throw errors.internal('Query validation middleware missing.');
  }
  return value;
}

export function validateParams<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(result.error);
      return;
    }
    (req as Request & { validatedParams?: T }).validatedParams = result.data;
    next();
  };
}

export function getValidatedParams<T>(req: Request): T {
  const value = (req as Request & { validatedParams?: T }).validatedParams;
  if (value === undefined) {
    throw errors.internal('Params validation middleware missing.');
  }
  return value;
}
