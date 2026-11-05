import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const TOKEN_ISSUER = 'premium-lms-api';
export const TOKEN_AUDIENCE = 'premium-lms-web';

export interface AccessClaims {
  /** User id (sub). */
  sub: string;
  /** Session id — lets us revoke access immediately when the session dies. */
  sid: string;
  typ: 'access';
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface SignAccessTokenInput {
  secret: string;
  userId: string;
  sessionId: string;
  ttlSeconds: number;
}

export async function signAccessToken(input: SignAccessTokenInput): Promise<string> {
  return new SignJWT({ sid: input.sessionId, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.userId)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds}s`)
    .sign(secretKey(input.secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    algorithms: ['HS256'],
  });
  if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('Token missing required claims');
  }
  return payload as unknown as AccessClaims;
}

/** Opaque refresh token: 256 bits of CSPRNG entropy, sent only in a cookie. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Refresh tokens are stored only as SHA-256 digests. The raw token has
 * sufficient entropy, so a plain hash (no KDF) is appropriate at rest.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
