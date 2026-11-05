import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { errors } from '../lib/errors.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * In-memory sliding-window rate limiter.
 *
 * Suitable for a single API instance. When the deployment topology becomes a
 * multi-instance setup, this must move to a shared store (open decision:
 * hosting/deployment, O-34). The interface below is the seam for that change.
 */
export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(key: string, windowStart: number): number[] {
    const timestamps = (this.attempts.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length === 0) this.attempts.delete(key);
    else this.attempts.set(key, timestamps);
    return timestamps;
  }

  /** Record an attempt and report whether it is allowed. */
  consume(key: string): RateLimitResult {
    const nowMs = this.now();
    const windowStart = nowMs - this.windowSeconds * 1000;
    const timestamps = this.prune(key, windowStart);

    if (timestamps.length >= this.maxAttempts) {
      const oldest = timestamps[0] ?? nowMs;
      const retryAfterMs = oldest + this.windowSeconds * 1000 - nowMs;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    timestamps.push(nowMs);
    this.attempts.set(key, timestamps);
    return {
      allowed: true,
      remaining: this.maxAttempts - timestamps.length,
      retryAfterSeconds: 0,
    };
  }

  /** Clear a key (e.g. after a successful login). */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  clear(): void {
    this.attempts.clear();
  }
}

export interface RateLimitMiddlewareOptions {
  limiter: SlidingWindowRateLimiter;
  keyOf: (req: Request) => string;
  message?: string;
}

export function rateLimit(options: RateLimitMiddlewareOptions): RequestHandler {
  const { limiter, keyOf } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const result = limiter.consume(keyOf(req));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      next(errors.tooManyRequests(result.retryAfterSeconds, options.message));
      return;
    }
    next();
  };
}
