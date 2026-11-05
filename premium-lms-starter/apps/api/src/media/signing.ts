import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed, short-lived delivery URLs.
 *
 * The raw grant is an opaque, DB-backed 256-bit secret. The HMAC signature
 * additionally binds the URL path, purpose, expiry, opaque session reference
 * and nonce, so parameters cannot be altered into a download or extended link
 * even if a token is observed. Signatures and tokens are never logged.
 */
export const MEDIA_DELIVERY_PATH = '/api/media/content';
export const MEDIA_QUERY_VERSION = 'lms.media.url.v1';
export const SESSION_REF_PATTERN = /^[0-9a-f]{12}$/;
export const MEDIA_GRANT_TTL_SECONDS = 300;

export type MediaPurpose = 'stream' | 'download';

export interface SignedMediaQuery {
  grant: string;
  purpose: MediaPurpose;
  exp: number;
  sid: string;
  nonce: string;
  sig: string;
}

export interface BuildSignedMediaUrlInput {
  token: string;
  purpose: MediaPurpose;
  expiresAt: string;
  sessionId: string;
  signingSecret: string;
  nonce?: string;
}

/** Short, opaque session reference for the signed URL and visible watermark. */
export function shortSessionRef(signingSecret: string, sessionId: string): string {
  return createHmac('sha256', signingSecret)
    .update(`lms.session-ref.v1\u001f${sessionId}`)
    .digest('hex')
    .slice(0, 12);
}

function canonicalUrlPayload(query: Omit<SignedMediaQuery, 'sig'>): string {
  return [
    MEDIA_QUERY_VERSION,
    MEDIA_DELIVERY_PATH,
    query.grant,
    query.purpose,
    String(query.exp),
    query.sid,
    query.nonce,
  ].join('\u001f');
}

function signatureFor(query: Omit<SignedMediaQuery, 'sig'>, signingSecret: string): string {
  return createHmac('sha256', signingSecret)
    .update(canonicalUrlPayload(query))
    .digest('hex');
}

function safeHexEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  // 64 hex characters decode to 32 bytes.
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

export function buildSignedMediaUrl(input: BuildSignedMediaUrlInput): string {
  const exp = Math.floor(Date.parse(input.expiresAt) / 1000);
  if (!Number.isFinite(exp)) {
    throw new Error('Media grant expiry is invalid');
  }
  const base = {
    grant: input.token,
    purpose: input.purpose,
    exp,
    sid: shortSessionRef(input.signingSecret, input.sessionId),
    nonce: input.nonce ?? randomBytes(16).toString('hex'),
  };
  const query = new URLSearchParams({
    grant: base.grant,
    purpose: base.purpose,
    exp: String(base.exp),
    sid: base.sid,
    nonce: base.nonce,
    sig: signatureFor(base, input.signingSecret),
  });
  return `${MEDIA_DELIVERY_PATH}?${query.toString()}`;
}

export type SignedMediaVerification =
  | { ok: true }
  | { ok: false; reason: 'media_signature_invalid' | 'media_signature_expired' | 'media_session_mismatch' };

export function verifySignedMediaUrl(
  query: SignedMediaQuery,
  signingSecret: string,
  currentSessionId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): SignedMediaVerification {
  if (
    !/^[0-9a-f]{64}$/.test(query.grant) ||
    !/^[0-9a-f]{32}$/.test(query.nonce) ||
    !SESSION_REF_PATTERN.test(query.sid) ||
    !Number.isInteger(query.exp)
  ) {
    return { ok: false, reason: 'media_signature_invalid' };
  }
  const expectedRef = shortSessionRef(signingSecret, currentSessionId);
  if (query.sid !== expectedRef) {
    return { ok: false, reason: 'media_session_mismatch' };
  }
  const { sig, ...signed } = query;
  if (!safeHexEqual(sig, signatureFor(signed, signingSecret))) {
    return { ok: false, reason: 'media_signature_invalid' };
  }
  if (query.exp <= nowSeconds) {
    return { ok: false, reason: 'media_signature_expired' };
  }
  if (query.exp > nowSeconds + MEDIA_GRANT_TTL_SECONDS) {
    return { ok: false, reason: 'media_signature_invalid' };
  }
  return { ok: true };
}
