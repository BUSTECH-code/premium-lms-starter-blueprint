import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import {
  PASSWORD_MIN_LENGTH,
  hashPassword,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../src/auth/passwords.js';

describe('password hashing (argon2id)', () => {
  it('hashes and verifies the correct password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct-horse-battery');
    expect(await verifyPassword(hash, 'correct-horse-battery')).toBe(true);
  });

  it('rejects wrong passwords', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(hash, 'correct-horse-batt ery')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('produces a unique salt per hash', async () => {
    const a = await hashPassword('same-password-value');
    const b = await hashPassword('same-password-value');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'same-password-value')).toBe(true);
    expect(await verifyPassword(b, 'same-password-value')).toBe(true);
  });

  it('enforces length bounds with a 400-level AppError', async () => {
    await expect(hashPassword('short')).rejects.toBeInstanceOf(AppError);
    await expect(hashPassword('short')).rejects.toMatchObject({ status: 400, code: 'bad_request' });
    await expect(hashPassword('x'.repeat(513))).rejects.toBeInstanceOf(AppError);
    await expect(hashPassword('x'.repeat(PASSWORD_MIN_LENGTH))).resolves.toMatch(/^\$argon2id\$/);
  });

  it('treats malformed stored hashes as verification failures', async () => {
    expect(await verifyPassword('not-a-real-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });

  it('timing-equalisation dummy verification always fails', async () => {
    expect(await verifyAgainstDummyHash('anything')).toBe(false);
    expect(await verifyAgainstDummyHash('')).toBe(false);
  });
});
