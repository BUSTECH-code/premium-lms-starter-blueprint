import { Algorithm, hash, verify } from '@node-rs/argon2';
import { errors } from '../lib/errors.js';

/**
 * Password hashing — argon2id with OWASP-recommended parameters
 * (m=19456 KiB, t=2, p=1). Hashes are stored in PHC string format and are
 * self-describing, so parameters can be migrated later without a flag day.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 512;

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    // A random hash of the same cost, used to equalise timing when the email
    // does not exist (prevents user enumeration via response timing).
    dummyHashPromise = hash(`dummy-${crypto.randomUUID()}`, ARGON2_OPTIONS);
  }
  return dummyHashPromise;
}

export async function hashPassword(plainPassword: string): Promise<string> {
  if (plainPassword.length < PASSWORD_MIN_LENGTH || plainPassword.length > PASSWORD_MAX_LENGTH) {
    throw errors.badRequest(
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
      { field: 'password' },
    );
  }
  return hash(plainPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, plainPassword: string): Promise<boolean> {
  if (plainPassword.length > PASSWORD_MAX_LENGTH) return false;
  try {
    return await verify(storedHash, plainPassword);
  } catch {
    return false; // malformed/legacy hash must not crash the login path
  }
}

/** Always-false verification against a real-cost hash (timing equalisation). */
export async function verifyAgainstDummyHash(plainPassword: string): Promise<boolean> {
  const dummy = await getDummyHash();
  return verifyPassword(dummy, plainPassword);
}
