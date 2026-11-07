import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  api,
  createTestApp,
  register,
  TEST_PAYSTACK_PUBLIC_KEY,
  TEST_PAYSTACK_SECRET_KEY,
  type TestApp,
} from './helpers.js';
import { makeFixtureUser, seedCourse } from './fixtures.js';
import {
  PaystackPaymentProvider,
  majorAmountToMinorUnits,
  minorUnitsToMajorAmount,
  parsePaystackWebhook,
  paystackWebhookSignature,
} from '../src/payments/paystack.js';

/**
 * Paystack integration tests. All outbound Paystack HTTP is stubbed; no real
 * credential or live network call is used. The API still exercises the real
 * DB transaction, raw-body HMAC verification and enrolment pipeline.
 */

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function installPaystackFetchMock(options: { verifyStatus?: string } = {}) {
  const verifyStatus = options.verifyStatus ?? 'success';
  const fetchMock = vi.fn(
    async (
      input: unknown,
      init?: { headers?: Record<string, string>; body?: string },
    ) => {
      const url = String(input);
      if (url.endsWith('/transaction/initialize')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { reference?: string };
        const reference = body.reference ?? 'paystack_missing_reference';
        return jsonResponse(200, {
          status: true,
          message: 'Authorization URL created',
          data: {
            authorization_url: `https://checkout.paystack.com/${reference}`,
            access_code: `access_${reference}`,
            reference,
          },
        });
      }
      if (url.includes('/transaction/verify/')) {
        const reference = decodeURIComponent(url.split('/').pop() ?? '');
        return jsonResponse(200, {
          status: true,
          message: 'Verification successful',
          data: {
            id: 987654,
            reference,
            amount: 2_500_000,
            currency: 'NGN',
            status: verifyStatus,
            paid_at: '2026-11-06T00:00:00.000Z',
          },
        });
      }
      return jsonResponse(404, { status: false, message: 'No Paystack stub for this URL.' });
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Paystack adapter primitives', () => {
  it('uses strict SHA-512 hex signatures over exact bytes and rejects malformed headers', () => {
    const raw = Buffer.from('{"event":"charge.success"}', 'utf8');
    const signature = paystackWebhookSignature(raw, TEST_PAYSTACK_SECRET_KEY);
    const provider = new PaystackPaymentProvider(TEST_PAYSTACK_SECRET_KEY);

    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(signature).toBe(
      createHmac('sha512', TEST_PAYSTACK_SECRET_KEY).update(raw).digest('hex'),
    );
    expect(provider.verify(raw, signature)).toBe(true);
    expect(provider.verify(Buffer.from(`${raw.toString('utf8')} `), signature)).toBe(false);
    expect(provider.verify(raw, `sha512=${signature}`)).toBe(false);
    expect(provider.verify(raw, '0'.repeat(128))).toBe(false);
    expect(provider.verify(raw, undefined)).toBe(false);
    expect(provider.verify(raw, signature.slice(0, 127))).toBe(false);
  });

  it('converts minor units exactly and ignores unsupported webhook events', () => {
    expect(majorAmountToMinorUnits('25000.00')).toBe(2_500_000);
    expect(minorUnitsToMajorAmount(2_500_001)).toBe('25000.01');
    expect(minorUnitsToMajorAmount(1)).toBe('0.01');
    expect(parsePaystackWebhook(Buffer.from('{"event":"subscription.create"}'))).toEqual({
      kind: 'ignored',
      reason: 'unsupported_event:subscription.create',
    });
  });
});

describe('live Paystack checkout integration', () => {
  let test: TestApp;
  let jar: Awaited<ReturnType<typeof register>>['jar'];
  let courseSlug: string;

  beforeEach(async () => {
    test = await createTestApp({
      PAYMENT_PROVIDER: 'paystack',
      RATE_LIMIT_CHECKOUT_MAX_ATTEMPTS: '1000',
    });
    const instructor = await makeFixtureUser(test.db);
    const course = await seedCourse(test.db, {
      createdBy: instructor.id,
      slug: 'paystack-course',
      title: 'Paystack Course',
      priceAmount: '25000.00',
    });
    courseSlug = course.slug;
    const registration = await register(test.app, {
      email: 'paystack-learner@example.com',
    });
    expect(registration.res.status).toBe(201);
    jar = registration.jar;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await test.close();
  });

  async function initialize() {
    const res = await api(test.app, jar)
      .post('/api/checkout/initialize')
      .send({ courseSlug });
    expect(res.status).toBe(200);
    return res;
  }

  async function enrollmentCount() {
    const res = await api(test.app, jar).get('/api/me/enrollments');
    expect(res.status).toBe(200);
    return (res.body.items as unknown[]).length;
  }

  function chargeEvent(reference: string) {
    return {
      event: 'charge.success',
      data: {
        id: 987654,
        reference,
        amount: 2_500_000,
        currency: 'NGN',
        status: 'success',
        paid_at: '2026-11-06T00:00:00.000Z',
      },
    };
  }

  function postWebhook(raw: string, signature?: string) {
    let req = request(test.app)
      .post('/api/checkout/webhook')
      .set('Content-Type', 'application/json')
      // Paystack is not a browser origin; originCheck must not mask HMAC auth.
      .set('Origin', 'https://hooks.paystack.com');
    if (signature !== undefined) req = req.set('x-paystack-signature', signature);
    return req.send(raw);
  }

  it('initializes a server-priced transaction and returns only public config', async () => {
    const fetchMock = installPaystackFetchMock();
    const res = await initialize();
    const reference = res.body.reference as string;

    expect(reference).toMatch(/^paystack_/);
    expect(res.body.authorizationUrl).toContain('https://checkout.paystack.com/');
    expect(res.body.accessCode).toBe(`access_${reference}`);
    expect(res.body.publicKey).toBe(TEST_PAYSTACK_PUBLIC_KEY);
    expect(res.body.email).toBe('paystack-learner@example.com');
    expect(res.body.checkout.order.status).toBe('payment_pending');
    expect(res.body.checkout.payment.status).toBe('pending');
    expect(res.body.checkout.payment.provider).toBe('paystack');
    expect(JSON.stringify(res.body)).not.toContain(TEST_PAYSTACK_SECRET_KEY);

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/transaction/initialize'),
    );
    expect(call).toBeTruthy();
    const init = call?.[1] as { headers?: Record<string, string>; body?: string } | undefined;
    expect(init?.headers?.Authorization).toBe(`Bearer ${TEST_PAYSTACK_SECRET_KEY}`);
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      email: 'paystack-learner@example.com',
      amount: 2_500_000,
      currency: 'NGN',
      reference,
      callback_url: 'http://localhost:5173/checkout/paystack/callback',
    });
    expect(payload.metadata).toMatchObject({ courseSlug });

    const { rows } = await test.db.query<{ status: string }>(
      'SELECT status FROM payments WHERE provider_reference = $1',
      [reference],
    );
    expect(rows[0]?.status).toBe('pending');
  });

  it('rejects missing, forged and raw-body-mutated signatures without granting access', async () => {
    installPaystackFetchMock();
    const res = await initialize();
    const reference = res.body.reference as string;
    const raw = JSON.stringify(chargeEvent(reference));
    const signature = paystackWebhookSignature(Buffer.from(raw), TEST_PAYSTACK_SECRET_KEY);

    const missing = await postWebhook(raw);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('invalid_signature');

    const forged = await postWebhook(raw, '0'.repeat(128));
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('invalid_signature');

    const mutated = await postWebhook(raw.replace('2500000', '2500001'), signature);
    expect(mutated.status).toBe(401);
    expect(mutated.body.error.code).toBe('invalid_signature');

    expect(await enrollmentCount()).toBe(0);
  });

  it('fulfils enrolment from a valid signed webhook exactly once', async () => {
    installPaystackFetchMock();
    const res = await initialize();
    const reference = res.body.reference as string;
    const raw = JSON.stringify(chargeEvent(reference));
    const signature = paystackWebhookSignature(Buffer.from(raw), TEST_PAYSTACK_SECRET_KEY);

    const first = await postWebhook(raw, signature);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('processed');
    expect(first.body.granted).toBe(true);
    expect(first.body.enrollmentCreated).toBe(true);
    expect(first.body.paymentStatus).toBe('succeeded');
    expect(first.body.orderStatus).toBe('paid');
    expect(await enrollmentCount()).toBe(1);

    const replay = await postWebhook(raw, signature);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('duplicate');
    expect(await enrollmentCount()).toBe(1);
  });

  it('acknowledges unsupported Paystack events without side effects', async () => {
    const raw = JSON.stringify({ event: 'subscription.create', data: {} });
    const signature = paystackWebhookSignature(Buffer.from(raw), TEST_PAYSTACK_SECRET_KEY);
    const res = await postWebhook(raw, signature);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    expect(res.body.reason).toBe('unsupported_event:subscription.create');
    expect(await enrollmentCount()).toBe(0);
  });

  it('verifies a callback for the owner and grants enrolment when the webhook was missed', async () => {
    installPaystackFetchMock();
    const res = await initialize();
    const reference = res.body.reference as string;

    const stranger = await register(test.app, { email: 'paystack-stranger@example.com' });
    expect(stranger.res.status).toBe(201);
    const denied = await api(test.app, stranger.jar).get(`/api/checkout/verify/${reference}`);
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('checkout_not_found');

    const verified = await api(test.app, jar).get(`/api/checkout/verify/${reference}`);
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe('processed');
    expect(verified.body.providerStatus).toBe('success');
    expect(verified.body.accessGranted).toBe(true);
    expect(verified.body.granted).toBe(true);
    expect(verified.body.checkout.order.status).toBe('paid');
    expect(await enrollmentCount()).toBe(1);
  });

  it('does not grant access when callback verification reports a non-success charge', async () => {
    installPaystackFetchMock({ verifyStatus: 'abandoned' });
    const res = await initialize();
    const reference = res.body.reference as string;

    const verified = await api(test.app, jar).get(`/api/checkout/verify/${reference}`);
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe('pending');
    expect(verified.body.providerStatus).toBe('abandoned');
    expect(verified.body.accessGranted).toBe(false);
    expect(await enrollmentCount()).toBe(0);
  });
});
