import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, createTestApp, register, type TestApp } from './helpers.js';
import { makeFixtureUser, seedCourse } from './fixtures.js';

/**
 * Full journey: browse catalogue → select a course → checkout → simulated
 * payment → webhook-verified grant → instant access in the learner library.
 * This is the Phase 2 E2E equivalent of a browser run (no browser tooling is
 * available in this environment — see docs/implementation/phase-2 notes).
 */
describe('purchase & enrolment journey', () => {
  let test: TestApp;
  let learnerJar: Awaited<ReturnType<typeof register>>['jar'];
  let courseSlug: string;

  beforeEach(async () => {
    test = await createTestApp({ RATE_LIMIT_CHECKOUT_MAX_ATTEMPTS: '1000' });
    const instructor = await makeFixtureUser(test.db, { name: 'Ada Instructor' });
    const course = await seedCourse(test.db, {
      createdBy: instructor.id,
      slug: 'journey-course',
      title: 'Journey Course',
      priceAmount: '25000.00',
      categories: ['engineering'],
      tags: ['node'],
    });
    courseSlug = course.slug;

    const registration = await register(test.app, { email: 'journey-learner@example.com' });
    expect(registration.res.status).toBe(201);
    learnerJar = registration.jar;
  });

  afterEach(async () => {
    await test.close();
  });

  async function startCheckout(slug = courseSlug) {
    const res = await api(test.app, learnerJar).post('/api/orders').send({ courseSlug: slug });
    return res;
  }

  it('browses, checks out, pays via simulation and gets instant access', async () => {
    // 1. Browse the public catalogue.
    const list = await api(test.app).get('/api/courses?search=journey');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].price).toEqual({ amount: '25000.00', currency: 'NGN' });

    // 2. Open the course landing page.
    const detail = await api(test.app).get(`/api/courses/${courseSlug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.course.purchasable).toBe(true);
    expect(detail.body.course.access.entitled).toBe(false);
    expect(detail.body.course.curriculum[0].lessons.length).toBeGreaterThan(0);

    // 3. No access yet.
    const before = await api(test.app, learnerJar).get('/api/me/enrollments');
    expect(before.body.items).toEqual([]);

    // 4. Start checkout (server sets the price).
    const order = await startCheckout();
    expect(order.status).toBe(201);
    expect(order.body.order.status).toBe('created');
    expect(order.body.order.totalAmount).toBe('25000.00');
    expect(order.body.payment.status).toBe('initiated');
    expect(order.body.payment.provider).toBe('simulated');
    expect(order.body.checkoutUrl).toBe(`/checkout/preview/${order.body.payment.providerReference}`);
    const reference = order.body.payment.providerReference as string;

    // 5. Inspect the checkout session.
    const session = await api(test.app, learnerJar).get(`/api/checkout/preview/${reference}`);
    expect(session.status).toBe(200);
    expect(session.body.payable).toBe(true);
    expect(session.body.expired).toBe(false);

    // 6. Pay (simulated gateway result → signed webhook event → pipeline).
    const paid = await api(test.app, learnerJar)
      .post(`/api/checkout/preview/${reference}/complete`)
      .send({ outcome: 'success' });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('processed');
    expect(paid.body.granted).toBe(true);
    expect(paid.body.enrollmentCreated).toBe(true);
    expect(paid.body.checkout.order.status).toBe('paid');
    expect(paid.body.checkout.payment.status).toBe('succeeded');

    // 7. Instant access: enrolled library + owned course view.
    const after = await api(test.app, learnerJar).get('/api/me/enrollments');
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0].course.slug).toBe(courseSlug);
    expect(after.body.items[0].status).toBe('active');

    const owned = await api(test.app, learnerJar).get(`/api/courses/${courseSlug}`);
    expect(owned.body.course.access).toEqual({ entitled: true, entitlementStatus: 'active' });
    expect(owned.body.course.purchasable).toBe(false);

    // 8. Order history reflects the completed purchase.
    const orders = await api(test.app, learnerJar).get('/api/orders');
    expect(orders.body.items).toHaveLength(1);
    expect(orders.body.items[0].status).toBe('paid');
    expect(orders.body.items[0].paymentStatus).toBe('succeeded');
    expect(orders.body.items[0].course.title).toBe('Journey Course');

    // 9. Duplicate purchase is blocked.
    const duplicate = await startCheckout();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('already_owned');

    // 10. Re-paying the same checkout is idempotent.
    const replay = await api(test.app, learnerJar)
      .post(`/api/checkout/preview/${reference}/complete`)
      .send({ outcome: 'success' });
    expect(replay.status).toBe(200);
    expect(replay.body.reason).toBe('already_paid');
    const finalEnrollments = await api(test.app, learnerJar).get('/api/me/enrollments');
    expect(finalEnrollments.body.items).toHaveLength(1);
  });

  it('ignores client-supplied prices (server is the price authority)', async () => {
    const res = await api(test.app, learnerJar)
      .post('/api/orders')
      .send({ courseSlug, amount: '1.00', currency: 'USD', totalAmount: 0 });
    expect(res.status).toBe(201);
    expect(res.body.order.totalAmount).toBe('25000.00');
    expect(res.body.order.currency).toBe('NGN');
  });

  it('resumes an open checkout instead of stacking parallel orders', async () => {
    const first = await startCheckout();
    expect(first.status).toBe(201);
    const second = await startCheckout();
    expect(second.status).toBe(200);
    expect(second.body.reused).toBe(true);
    expect(second.body.order.id).toBe(first.body.order.id);
  });

  it('records failure then allows a late success (success precedence)', async () => {
    const order = await startCheckout();
    const reference = order.body.payment.providerReference as string;

    const failed = await api(test.app, learnerJar)
      .post(`/api/checkout/preview/${reference}/complete`)
      .send({ outcome: 'failure' });
    expect(failed.body.status).toBe('processed');
    expect(failed.body.checkout.order.status).toBe('failed');
    expect(failed.body.checkout.payment.status).toBe('failed');
    expect(failed.body.granted).toBe(false);

    const empty = await api(test.app, learnerJar).get('/api/me/enrollments');
    expect(empty.body.items).toEqual([]);

    // Provider corrects itself: money arrives after the failure event.
    const recovered = await api(test.app, learnerJar)
      .post(`/api/checkout/preview/${reference}/complete`)
      .send({ outcome: 'success' });
    expect(recovered.body.status).toBe('processed');
    expect(recovered.body.granted).toBe(true);
    expect(recovered.body.checkout.order.status).toBe('paid');

    const enrollments = await api(test.app, learnerJar).get('/api/me/enrollments');
    expect(enrollments.body.items).toHaveLength(1);
  });

  it('owner cancels an open checkout; a fresh one can be started after', async () => {
    const order = await startCheckout();
    const orderId = order.body.order.id as string;
    const reference = order.body.payment.providerReference as string;

    const cancelled = await api(test.app, learnerJar).post(`/api/orders/${orderId}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('cancelled');
    expect(cancelled.body.payment.status).toBe('expired');

    // The cancelled session can no longer be paid.
    const late = await api(test.app, learnerJar)
      .post(`/api/checkout/preview/${reference}/complete`)
      .send({ outcome: 'success' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('checkout_not_open');

    // A new checkout for the same course works.
    const again = await startCheckout();
    expect(again.status).toBe(201);
    expect(again.body.order.id).not.toBe(orderId);

    // Cancelling twice is rejected.
    const twice = await api(test.app, learnerJar).post(`/api/orders/${orderId}/cancel`);
    expect(twice.status).toBe(409);
  });

  it('sweeps abandoned checkouts past the TTL', async () => {
    const order = await startCheckout();
    const orderId = order.body.order.id as string;
    const reference = order.body.payment.providerReference as string;

    await test.db.query(
      `UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [orderId],
    );

    const expired = await api(test.app, learnerJar)
      .post(`/api/checkout/preview/${reference}/complete`)
      .send({ outcome: 'success' });
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('checkout_expired');

    const { rows } = await test.db.query<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1',
      [orderId],
    );
    expect(rows[0]?.status).toBe('cancelled');

    // No stale open order blocks a fresh checkout.
    const fresh = await startCheckout();
    expect(fresh.status).toBe(201);
    expect(fresh.body.order.id).not.toBe(orderId);
  });

  it('quarantines payment when the course is withdrawn mid-checkout (no access)', async () => {
    const order = await startCheckout();
    const reference = order.body.payment.providerReference as string;
    const orderId = order.body.order.id as string;

    await test.db.query(`UPDATE courses SET status = 'withdrawn' WHERE slug = $1`, [courseSlug]);

    const result = await api(test.app, learnerJar)
      .post(`/api/checkout/preview/${reference}/complete`)
      .send({ outcome: 'success' });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('quarantined');
    expect(result.body.granted).toBe(false);

    // Nothing was granted; money state untouched pending reconciliation.
    const enrollments = await api(test.app, learnerJar).get('/api/me/enrollments');
    expect(enrollments.body.items).toEqual([]);
    const { rows: orderRows } = await test.db.query<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1',
      [orderId],
    );
    expect(orderRows[0]?.status).toBe('created');
    const { rows: paymentRows } = await test.db.query<{ status: string }>(
      `SELECT status FROM payments WHERE provider_reference = $1`,
      [reference],
    );
    expect(paymentRows[0]?.status).toBe('initiated');

    // The withdrawn course disappears from public browsing/detail.
    expect((await api(test.app).get(`/api/courses/${courseSlug}`)).status).toBe(404);
    const list = await api(test.app).get('/api/courses');
    expect(list.body.items).toHaveLength(0);
  });

  it('enforces ownership on order reads and checkout actions', async () => {
    const order = await startCheckout();
    const orderId = order.body.order.id as string;
    const reference = order.body.payment.providerReference as string;

    const stranger = await register(test.app, { email: 'stranger@example.com' });
    expect(stranger.res.status).toBe(201);

    const read = await api(test.app, stranger.jar).get(`/api/orders/${orderId}`);
    expect(read.status).toBe(404);

    const cancel = await api(test.app, stranger.jar).post(`/api/orders/${orderId}/cancel`);
    expect(cancel.status).toBe(404);

    const session = await api(test.app, stranger.jar).get(`/api/checkout/preview/${reference}`);
    expect(session.status).toBe(404);

    const pay = await api(test.app, stranger.jar)
      .post(`/api/checkout/preview/${reference}/complete`)
      .send({ outcome: 'success' });
    expect(pay.status).toBe(404);
  });

  it('requires authentication for purchase endpoints', async () => {
    expect((await api(test.app).post('/api/orders').send({ courseSlug })).status).toBe(401);
    expect((await api(test.app).get('/api/me/enrollments')).status).toBe(401);
    expect((await api(test.app).get('/api/orders')).status).toBe(401);
    expect(
      (
        await api(test.app)
          .post('/api/checkout/preview/simulated_x123456/complete')
          .send({ outcome: 'success' })
      ).status,
    ).toBe(401);
  });

  it('rate-limits repeated checkout attempts per user', async () => {
    const limited = await createTestApp({
      RATE_LIMIT_CHECKOUT_MAX_ATTEMPTS: '2',
      RATE_LIMIT_CHECKOUT_WINDOW_SECONDS: '300',
    });
    try {
      const instructor = await makeFixtureUser(limited.db);
      await seedCourse(limited.db, { createdBy: instructor.id, slug: 'limited-course' });
      const registration = await register(limited.app, { email: 'limited@example.com' });

      const first = await api(limited.app, registration.jar)
        .post('/api/orders')
        .send({ courseSlug: 'limited-course' });
      expect(first.status).toBe(201);
      const second = await api(limited.app, registration.jar)
        .post('/api/orders')
        .send({ courseSlug: 'limited-course' });
      expect(second.status).toBe(200); // resumed checkout still consumes budget
      const third = await api(limited.app, registration.jar)
        .post('/api/orders')
        .send({ courseSlug: 'limited-course' });
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('rate_limited');
      expect(third.headers['retry-after']).toBeDefined();
    } finally {
      await limited.close();
    }
  });
});
