import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PaymentEvent } from '../commerce/events.js';
import { AppError } from '../lib/errors.js';

/**
 * Paystack adapter.
 *
 * - `PAYSTACK_SECRET_KEY` stays server-side: it authorises API calls and is
 *   the HMAC key for `x-paystack-signature` webhook verification.
 * - `PAYSTACK_PUBLIC_KEY` / `VITE_PAYSTACK_PUBLIC_KEY` are public browser
 *   configuration only and are never used to authenticate a payment.
 * - All provider facts (reference, amount, currency, status) are re-checked
 *   against our own payment row before the existing enrolment transaction runs.
 */

export const PAYSTACK_SIGNATURE_HEADER = 'x-paystack-signature';
export const DEFAULT_PAYSTACK_API_BASE_URL = 'https://api.paystack.co';

const PAYSTACK_REFERENCE = /^[A-Za-z0-9_-]{8,200}$/;
const PAYSTACK_SECRET_KEY = /^sk_(test|live)_[A-Za-z0-9_-]{8,}$/;

/** Constant-time SHA-512 HMAC over the exact bytes Paystack signed. */
export class PaystackPaymentProvider {
  readonly name = 'paystack';

  constructor(private readonly secretKey: string) {
    if (!PAYSTACK_SECRET_KEY.test(secretKey)) {
      throw new Error('A valid Paystack secret key is required.');
    }
  }

  sign(rawBody: Buffer): string {
    return createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
  }

  verify(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (typeof signatureHeader !== 'string' || !/^[0-9a-f]{128}$/i.test(signatureHeader)) {
      return false;
    }
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    const provided = Buffer.from(signatureHeader, 'hex');
    if (expected.length !== 64 || provided.length !== expected.length) return false;
    return timingSafeEqual(expected, provided);
  }
}

export function paystackWebhookSignature(rawBody: Buffer, secretKey: string): string {
  return new PaystackPaymentProvider(secretKey).sign(rawBody);
}

interface PaystackFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type PaystackFetch = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<PaystackFetchResponse>;

const paystackInitializeResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    authorization_url: z.string().url(),
    access_code: z.string().trim().min(1).max(512),
    reference: z.string().regex(PAYSTACK_REFERENCE),
  }),
});

const paystackTransactionSchema = z.object({
  id: z.union([z.string().trim().min(1).max(128), z.number().int().nonnegative()]),
  reference: z.string().regex(PAYSTACK_REFERENCE),
  amount: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.string().trim().min(1).max(64),
  paid_at: z.union([z.string().max(64), z.null()]).optional(),
});

const paystackVerifyResponseSchema = z.object({
  status: z.literal(true),
  data: paystackTransactionSchema,
});

const paystackChargeWebhookSchema = z.object({
  event: z.literal('charge.success'),
  data: paystackTransactionSchema.extend({ status: z.literal('success') }),
});

const paystackWebhookEnvelopeSchema = z.object({
  event: z.string().trim().min(1).max(64),
});

export type PaystackTransaction = z.infer<typeof paystackTransactionSchema>;

export interface PaystackClientConfig {
  secretKey: string;
  apiBaseUrl?: string;
  /** Injectable for unit tests; production uses the Node global fetch lazily. */
  fetchImpl?: PaystackFetch;
}

export interface PaystackInitializeInput {
  email: string;
  amountMinorUnits: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export interface PaystackInitialization {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/** Convert our NUMERIC(12,2) price to Paystack's integer minor units. */
export function majorAmountToMinorUnits(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) {
    throw new AppError(500, 'invalid_amount', 'Stored payment amount is invalid.');
  }
  const major = BigInt(match[1] ?? '0');
  const cents = BigInt((match[2] ?? '').padEnd(2, '0'));
  const total = major * 100n + cents;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(500, 'invalid_amount', 'Stored payment amount is too large.');
  }
  return Number(total);
}

/** Convert Paystack's integer minor units back to a canonical 2-decimal string. */
export function minorUnitsToMajorAmount(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new AppError(502, 'paystack_invalid_response', 'Payment provider returned an invalid amount.');
  }
  const minor = BigInt(amount);
  return `${(minor / 100n).toString()}.${(minor % 100n).toString().padStart(2, '0')}`;
}

/** Only allow redirects to Paystack-owned HTTPS hosts, even if the API is mocked. */
export function isPaystackAuthorizationUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'paystack.com' ||
    host === 'paystack.co' ||
    host.endsWith('.paystack.com') ||
    host.endsWith('.paystack.co')
  );
}

function apiUrl(baseUrl: string, path: string): string {
  const normalised = baseUrl.replace(/\/+$/, '');
  return new URL(path, `${normalised}/`).toString();
}

function providerError(code: string): AppError {
  return new AppError(
    502,
    code,
    'The payment provider is temporarily unavailable. Please try again.',
  );
}

export class PaystackClient {
  private readonly secretKey: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl?: PaystackFetch;

  constructor(config: PaystackClientConfig) {
    if (!PAYSTACK_SECRET_KEY.test(config.secretKey)) {
      throw new Error('A valid Paystack secret key is required.');
    }
    this.secretKey = config.secretKey;
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_PAYSTACK_API_BASE_URL;
    this.fetchImpl = config.fetchImpl;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const globalFetch = (globalThis as typeof globalThis & { fetch?: unknown }).fetch;
    const fetchImpl = this.fetchImpl ?? (typeof globalFetch === 'function' ? (globalFetch as PaystackFetch) : undefined);
    if (!fetchImpl) throw providerError('paystack_unavailable');

    let response: PaystackFetchResponse;
    try {
      response = await fetchImpl(apiUrl(this.apiBaseUrl, path), {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw providerError('paystack_unavailable');
    }
    if (!response.ok) throw providerError('paystack_request_failed');
    try {
      return await response.json();
    } catch {
      throw providerError('paystack_invalid_response');
    }
  }

  async initializeTransaction(input: PaystackInitializeInput): Promise<PaystackInitialization> {
    const payload = await this.request('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amountMinorUnits,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    });
    const parsed = paystackInitializeResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.data.reference !== input.reference) {
      throw providerError('paystack_invalid_response');
    }
    const { authorization_url, access_code, reference } = parsed.data.data;
    if (!isPaystackAuthorizationUrl(authorization_url)) {
      throw providerError('paystack_invalid_response');
    }
    return { authorizationUrl: authorization_url, accessCode: access_code, reference };
  }

  async verifyTransaction(reference: string): Promise<PaystackTransaction> {
    if (!PAYSTACK_REFERENCE.test(reference)) {
      throw new AppError(400, 'invalid_reference', 'Invalid payment reference.');
    }
    const payload = await this.request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const parsed = paystackVerifyResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.data.reference !== reference) {
      throw providerError('paystack_invalid_response');
    }
    return parsed.data.data;
  }
}

/** Stable idempotency key shared by a webhook and a later callback verification. */
export function paystackTransactionToEvent(
  transaction: PaystackTransaction,
  kind: 'charge.success' | 'charge.failed',
): PaymentEvent {
  const fingerprint = createHash('sha256')
    .update(`${kind}:${String(transaction.id)}:${transaction.reference}`)
    .digest('hex');
  const created =
    typeof transaction.paid_at === 'string' && transaction.paid_at.length <= 64
      ? transaction.paid_at
      : new Date().toISOString();
  return {
    id: `paystack:${kind}:${fingerprint}`,
    type: kind === 'charge.success' ? 'payment.succeeded' : 'payment.failed',
    created,
    data: {
      payment: {
        reference: transaction.reference,
        amount: minorUnitsToMajorAmount(transaction.amount),
        currency: transaction.currency,
      },
    },
  };
}

export type PaystackWebhookParseResult =
  | { kind: 'ignored'; reason: string }
  | { kind: 'event'; event: PaymentEvent; payload: unknown };

/**
 * Parse an already signature-verified Paystack webhook. Only a successful
 * charge can enter the grant pipeline; other provider events are acknowledged
 * without side effects.
 */
export function parsePaystackWebhook(rawBody: Buffer): PaystackWebhookParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError(400, 'invalid_event', 'Webhook body is not valid JSON.');
  }
  const envelope = paystackWebhookEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new AppError(400, 'invalid_event', 'Webhook event is missing its type.');
  }
  if (envelope.data.event !== 'charge.success') {
    const safeEvent = envelope.data.event.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
    return { kind: 'ignored', reason: `unsupported_event:${safeEvent}` };
  }
  const charge = paystackChargeWebhookSchema.safeParse(parsed);
  if (!charge.success) {
    throw new AppError(400, 'invalid_event', 'Webhook charge payload does not match Paystack schema.');
  }
  return {
    kind: 'event',
    event: paystackTransactionToEvent(charge.data.data, 'charge.success'),
    payload: parsed,
  };
}
