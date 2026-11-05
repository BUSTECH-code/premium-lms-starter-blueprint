import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { api, createTestApp, register, type TestApp } from './helpers.js';
import { makeFixtureUser, seedCourse } from './fixtures.js';

/**
 * Provider-callback tests: HMAC authenticity, idempotent event receipts,
 * money re-validation, out-of-order precedence, quarantine rules, and the
 * refund path that must never silently revoke access (O-20 open).
 */
describe('payment webhooks', () => {
  let test: TestApp;
  let jar: Awaited<ReturnType<typeof register>>['jar'];
  let reference: string;
  let amount: string;

  beforeEach(async () => {
    test = await createTestApp({ RATE_LIMIT_CHECKOUT_MAX_ATTEMPTS: '1000' });
    const instructor = await makeFixtureUser(test.db);
    const course = await seedCourse(test.db, {
      createdBy: instructor.id,
      slug: 'webhook-course',
      title: 'Webhook Course',
      priceAmount: '15000.00',
    });

    const registration = await register(test.app, { email: 'webhook-learner@example.com' });
    expect(registration.res.status).toBe(201);
    jar = registration.jar;

    const order = await api(test.app, jar).post('/api/orders').send({ courseSlug: course.slug });
    expect(order.status).toBe(201);
    reference = order.body.payment.providerReference as string;
    amount = order.body.order.totalAmount as string;
  });

  afterEach(async () => {
    await test.close();
  });

  function signRaw(rawBody: string): string {
    const digest = createHmac('sha256', test.env.commerce.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return `sha256=${digest}`;
  }

  /**
   * Serialise the event ONCE and sign those exact bytes. Signing a separately
   * constructed copy of the event can straddle a millisecond boundary in the
   * `created` field and produce a legitimate-looking signature mismatch.
   */
  function postEvent(event: Record<string, unknown>, mode?: 'valid' | 'forged') {
    const raw = JSON.stringify(event);
    let req = request(test.app)
      .post('/api/webhooks/payments')
      .set('Content-Type', 'application/json');
    if (mode === 'valid') req = req.set('x-lms-signature', signRaw(raw));
    if (mode === 'forged') req = req.set('x-lms-signature', `sha256=${'0'.repeat(64)}`);
    return req.send(raw);
  }

  function succeededEvent(id: string, overrides: { amount?: string | number } = {}) {
    return {
      id,
      type: 'payment.succeeded',
      created: new Date().toISOString(),
      data: {
        payment: { reference, amount: overrides.amount ?? amount, currency: 'NGN' },
      },
    };
  }

  it('rejects unsigned and badly signed deliveries', async () => {
    const unsigned = await postEvent(succeededEvent('evt_unsigned'));
    expect(unsigned.status).toBe(401);
    expect(unsigned.body.error.code).toBe('invalid_signature');

    const forged = await postEvent(succeededEvent('evt_forged'), 'forged');
    expect(forged.status).toBe(401);

    // Nothing was applied.
    const enrollments = await api(test.app, jar).get('/api/me/enrollments');
    expect(enrollments.body.items).toEqual([]);
  });

  it('rejects malformed events after signature verification', async () => {
    const res = await postEvent({ id: 'evt_bad', type: 'payment.exploded' }, 'valid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_event');
  });

  it('processes a valid success event and grants access exactly once', async () => {
    const first = succeededEvent('evt_success_1');
    const res = await postEvent(first, 'valid');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.granted).toBe(true);
    expect(res.body.orderStatus).toBe('paid');
    expect(res.body.paymentStatus).toBe('succeeded');

    const enrollments = await api(test.app, jar).get('/api/me/enrollments');
    expect(enrollments.body.items).toHaveLength(1);

    // Exact replay (same event id) is a duplicate — no second grant.
    const replay = await postEvent(first, 'valid');
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('duplicate');

    // A different event id for the same already-succeeded payment is
    // recognised as already applied.
    const second = succeededEvent('evt_success_2');
    const again = await postEvent(second, 'valid');
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('processed');
    expect(again.body.reason).toBe('already_applied');

    const after = await api(test.app, jar).get('/api/me/enrollments');
    expect(after.body.items).toHaveLength(1);
  });

  it('quarantines amount mismatches, currency mismatches and unknown references', async () => {
    const wrongAmount = succeededEvent('evt_amount', { amount: '1.00' });
    const res1 = await postEvent(wrongAmount, 'valid');
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('quarantined');
    expect(res1.body.reason).toBe('amount_mismatch');

    const wrongCurrency = {
      ...succeededEvent('evt_currency'),
      data: { payment: { reference, amount, currency: 'USD' } },
    };
    const res2 = await postEvent(wrongCurrency, 'valid');
    expect(res2.body.status).toBe('quarantined');
    expect(res2.body.reason).toBe('currency_mismatch');

    const unknown = {
      id: 'evt_unknown',
      type: 'payment.succeeded',
      created: new Date().toISOString(),
      data: { payment: { reference: 'simulated_does-not-exist', amount, currency: 'NGN' } },
    };
    const res3 = await postEvent(unknown, 'valid');
    expect(res3.body.status).toBe('quarantined');
    expect(res3.body.reason).toBe('unknown_payment_reference');

    const enrollments = await api(test.app, jar).get('/api/me/enrollments');
    expect(enrollments.body.items).toEqual([]);
  });

  it('ignores an out-of-order failure delivered after success', async () => {
    const success = succeededEvent('evt_pre_failure');
    await postEvent(success, 'valid');

    const failure = {
      id: 'evt_late_failure',
      type: 'payment.failed',
      created: new Date().toISOString(),
      data: { payment: { reference, amount, currency: 'NGN' } },
    };
    const res = await postEvent(failure, 'valid');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    expect(res.body.reason).toBe('failure_after_success');

    // Access survives the late failure.
    const enrollments = await api(test.app, jar).get('/api/me/enrollments');
    expect(enrollments.body.items).toHaveLength(1);
    const orders = await api(test.app, jar).get('/api/orders');
    expect(orders.body.items[0].status).toBe('paid');
  });

  it('applies refunds to money state without revoking access (O-20 open)', async () => {
    const success = succeededEvent('evt_before_refund');
    await postEvent(success, 'valid');

    const refund = {
      id: 'evt_refund_1',
      type: 'payment.refunded',
      created: new Date().toISOString(),
      data: { payment: { reference, amount, currency: 'NGN' } },
    };
    const res = await postEvent(refund, 'valid');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.orderStatus).toBe('refunded');
    expect(res.body.paymentStatus).toBe('refunded');

    // Entitlement and enrolment untouched — revocation policy is an open
    // decision (O-20); the event audit flags review instead.
    const enrollments = await api(test.app, jar).get('/api/me/enrollments');
    expect(enrollments.body.items).toHaveLength(1);
    const course = await api(test.app, jar).get('/api/courses/webhook-course');
    expect(course.body.course.access.entitled).toBe(true);

    const { rows } = await test.db.query<{ metadata: { entitlementReview?: string } }>(
      `SELECT metadata FROM audit_events WHERE action = 'payment.refunded'`,
    );
    expect(rows[0]?.metadata.entitlementReview).toBe('required');
  });

  it('sends a reversal after failure as ignored (money never settled)', async () => {
    const failure = {
      id: 'evt_fail_before_reversal',
      type: 'payment.failed',
      created: new Date().toISOString(),
      data: { payment: { reference, amount, currency: 'NGN' } },
    };
    await postEvent(failure, 'valid');

    const reversal = {
      id: 'evt_reversal_1',
      type: 'payment.reversed',
      created: new Date().toISOString(),
      data: { payment: { reference, amount, currency: 'NGN' } },
    };
    const res = await postEvent(reversal, 'valid');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    expect(res.body.reason).toContain('not_captured');
  });
});
