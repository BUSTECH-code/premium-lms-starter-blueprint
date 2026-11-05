import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/auth/rate-limit.js';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to maxAttempts within the window, then denies', () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter(3, 60, () => now);

    expect(limiter.consume('k').allowed).toBe(true);
    expect(limiter.consume('k').allowed).toBe(true);
    const third = limiter.consume('k');
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const denied = limiter.consume('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('slides the window as old attempts expire', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(2, 60, () => now);

    limiter.consume('k'); // t=0
    now = 30_000;
    limiter.consume('k'); // t=30
    expect(limiter.consume('k').allowed).toBe(false); // both still in window

    now = 61_000; // first attempt (t=0) expired
    expect(limiter.consume('k').allowed).toBe(true);
    expect(limiter.consume('k').allowed).toBe(false);
  });

  it('tracks keys independently and supports reset', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60);
    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(false);
    expect(limiter.consume('b').allowed).toBe(true);

    limiter.reset('a');
    expect(limiter.consume('a').allowed).toBe(true);
  });

  it('reports retryAfterSeconds counting down within the window', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(1, 60, () => now);
    limiter.consume('k');
    now = 40_000;
    const denied = limiter.consume('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(20);
  });
});
