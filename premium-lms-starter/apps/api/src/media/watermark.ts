import type { AuthContext } from '../auth/context.js';
import { shortSessionRef } from './signing.js';

export interface ViewerWatermark {
  email: string;
  /** Opaque short session reference, never the raw session UUID. */
  sessionRef: string;
  /** Trusted server timestamp for the visible player overlay. */
  issuedAt: string;
}

/**
 * Approved Phase 4 player watermark. It is a visible deterrent only: no media
 * bytes are mutated, so PDF/video checksums and range responses stay exact.
 */
export function buildViewerWatermark(
  auth: AuthContext,
  signingSecret: string,
  now: () => Date = () => new Date(),
): ViewerWatermark {
  return {
    email: auth.user.email,
    sessionRef: shortSessionRef(signingSecret, auth.sessionId),
    issuedAt: now().toISOString(),
  };
}
