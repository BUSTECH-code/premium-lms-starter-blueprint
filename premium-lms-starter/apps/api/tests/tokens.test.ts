import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../src/auth/tokens.js';
import { TEST_JWT_SECRET } from './helpers.js';

const secret = TEST_JWT_SECRET;

describe('access tokens (JWT)', () => {
  it('signs and verifies with the expected claims', async () => {
    const token = await signAccessToken({
      secret,
      userId: 'user-1',
      sessionId: 'session-1',
      ttlSeconds: 900,
    });
    const claims = await verifyAccessToken(token, secret);
    expect(claims.sub).toBe('user-1');
    expect(claims.sid).toBe('session-1');
    expect(claims.typ).toBe('access');
    expect(claims.iss).toBe(TOKEN_ISSUER);
    expect(claims.aud).toBe(TOKEN_AUDIENCE);
    expect(claims.exp - claims.iat).toBe(900);
  });

  it('rejects tokens signed with a different secret', async () => {
    const token = await signAccessToken({
      secret,
      userId: 'user-1',
      sessionId: 'session-1',
      ttlSeconds: 900,
    });
    await expect(verifyAccessToken(token, 'another-secret-that-is-different!')).rejects.toThrow();
  });

  it('rejects tampered tokens', async () => {
    const token = await signAccessToken({
      secret,
      userId: 'user-1',
      sessionId: 'session-1',
      ttlSeconds: 900,
    });
    const tampered = `${token.slice(0, -3)}abc`;
    await expect(verifyAccessToken(tampered, secret)).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const key = new TextEncoder().encode(secret);
    const expired = await new SignJWT({ sid: 'session-1', typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(key);
    await expect(verifyAccessToken(expired, secret)).rejects.toThrow();
  });

  it('rejects tokens with the wrong algorithm', async () => {
    const key = new TextEncoder().encode(secret);
    const hs512 = await new SignJWT({ sid: 'session-1', typ: 'access' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('user-1')
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(key);
    await expect(verifyAccessToken(hs512, secret)).rejects.toThrow();
  });

  it('rejects tokens missing required claims', async () => {
    const key = new TextEncoder().encode(secret);
    const noSid = await new SignJWT({ typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(key);
    await expect(verifyAccessToken(noSid, secret)).rejects.toThrow();
  });
});

describe('refresh tokens', () => {
  it('generates unique, high-entropy opaque tokens', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically to a SHA-256 hex digest', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).toBe(hash);
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(hash);
    expect(hash).not.toContain(token);
  });
});
