import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaystackPaymentProvider } from './paystack.js';

/**
 * Payment provider seam.
 *
 * The product owner selected Paystack for the live gateway integration; the
 * simulated provider remains available for local development and tests. This
 * interface is the only contract the commerce layer depends on, so both
 * providers use the same order/entitlement pipeline.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Signature header value for a raw request body (webhook authenticity). */
  sign(rawBody: Buffer): string;
  /** Constant-time verification of a signature header against the raw body. */
  verify(rawBody: Buffer, signatureHeader: string | undefined): boolean;
}

export const WEBHOOK_SIGNATURE_HEADER = 'x-lms-signature';

/**
 * Simulated provider: HMAC-SHA256 over the exact webhook bytes, formatted
 * `sha256=<hex>`. Used both by external POSTs to the webhook endpoint and by
 * the in-app simulated checkout (which builds a signed event and runs it
 * through the same webhook pipeline — there is no separate grant path).
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'simulated';

  constructor(private readonly secret: string) {
    if (secret.length < 32) {
      throw new Error('Webhook secret must be at least 32 characters.');
    }
  }

  sign(rawBody: Buffer): string {
    const digest = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    return `sha256=${digest}`;
  }

  verify(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
      return false;
    }
    const expected = Buffer.from(this.sign(rawBody), 'utf8');
    const provided = Buffer.from(signatureHeader, 'utf8');
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  }
}

export function createPaymentProvider(config: {
  provider: 'simulated' | 'paystack';
  webhookSecret: string;
  paystackSecretKey?: string;
}): PaymentProvider {
  if (config.provider === 'simulated') {
    return new SimulatedPaymentProvider(config.webhookSecret);
  }
  if (config.provider === 'paystack') {
    if (!config.paystackSecretKey) {
      throw new Error('PAYSTACK_SECRET_KEY is required for Paystack payments.');
    }
    return new PaystackPaymentProvider(config.paystackSecretKey);
  }
  // parseEnv already restricts the enum; fail closed if that ever changes.
  throw new Error(`Unsupported payment provider: ${String(config.provider)}`);
}
