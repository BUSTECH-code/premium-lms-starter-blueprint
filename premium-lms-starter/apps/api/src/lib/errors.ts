/**
 * Application errors with a safe, stable API error contract:
 *   { "error": { "code": "...", "message": "...", "details"?: ... } }
 * Messages are safe to return to clients — never include secrets, stack
 * traces or internal details.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export const errors = {
  badRequest: (message: string, details?: unknown) =>
    new AppError(400, 'bad_request', message, details),

  unauthorized: (code = 'unauthorized', message = 'Authentication required.') =>
    new AppError(401, code, message),

  forbidden: (code = 'forbidden', message = 'You do not have permission to perform this action.') =>
    new AppError(403, code, message),

  notFound: (code = 'not_found', message = 'Resource not found.') =>
    new AppError(404, code, message),

  conflict: (code = 'conflict', message: string, details?: unknown) =>
    new AppError(409, code, message, details),

  tooManyRequests: (retryAfterSeconds: number, message = 'Too many requests. Please try again later.') =>
    new AppError(429, 'rate_limited', message, { retryAfterSeconds }),

  internal: (message = 'An unexpected error occurred.') =>
    new AppError(500, 'internal_error', message),
};
