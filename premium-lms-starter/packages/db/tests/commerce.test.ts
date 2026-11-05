import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers.js';
import { makeUser, seedCourse } from './helpers/fixtures.js';
import {
  CommerceError,
  createOrder,
  expireStaleOrders,
  finishPaymentEvent,
  getOwnedOrder,
  insertPaymentEvent,
  listEnrollmentsForUser,
  listOrdersForUser,
  processPaymentFailure,
  processPaymentSuccess,
  processRefund,
} from '../src/repos/commerce.js';
import {
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  canOrderTransition,
  canPaymentTransition,
} from '../src/domain/order-state.js';
import type { DbClient } from '../src/client.js';

async function newOrder(db: DbClient, userId: string, courseId: string) {
  // Re-read course fields the way the service would.
  const { rows } = await db.query<{
    id: string;
    slug: string;
    title: string;
    price_amount: string;
    price_currency: string;
  }>(
    `SELECT id, slug, title, price_amount::text AS price_amount, price_currency
       FROM courses WHERE id = $1`,
    [courseId],
  );
  const course = rows[0];
  if (!course) throw new Error('course missing');
  return createOrder(db, { userId, provider: 'simulated', checkoutTtlMinutes: 30, course });
}

async function auditActions(db: DbClient): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>(
    'SELECT action FROM audit_events ORDER BY created_at, id',
  );
  return rows.map((row) => row.action);
}

describe('order & payment state machines', () => {
  it('matches the documented transitions', () => {
    expect(ORDER_TRANSITIONS.created).toEqual(['payment_pending', 'cancelled', 'failed']);
    expect(ORDER_TRANSITIONS.payment_pending).toEqual(['paid', 'failed', 'cancelled']);
    expect(ORDER_TRANSITIONS.paid).toEqual(['partially_refunded', 'refunded', 'reversed']);
    expect(ORDER_TRANSITIONS.failed).toEqual(['paid']);
    expect(ORDER_TRANSITIONS.cancelled).toEqual([]);
    expect(ORDER_TRANSITIONS.refunded).toEqual([]);
    expect(ORDER_TRANSITIONS.reversed).toEqual([]);

    expect(PAYMENT_TRANSITIONS.initiated).toEqual(['pending', 'failed', 'expired', 'succeeded']);
    expect(PAYMENT_TRANSITIONS.pending).toEqual(['succeeded', 'failed', 'expired']);
    expect(PAYMENT_TRANSITIONS.succeeded).toEqual(['refunded', 'reversed']);
    expect(PAYMENT_TRANSITIONS.failed).toEqual(['succeeded']);
    expect(PAYMENT_TRANSITIONS.expired).toEqual([]);
    expect(PAYMENT_TRANSITIONS.refunded).toEqual([]);
    expect(PAYMENT_TRANSITIONS.reversed).toEqual([]);

    // Terminal states never transition out.
    expect(canOrderTransition('cancelled', 'paid')).toBe(false);
    expect(canPaymentTransition('refunded', 'succeeded')).toBe(false);
    // No refunds/chargebacks ever grant access.
    expect(canOrderTransition('paid', 'cancelled')).toBe(false);
    expect(canPaymentTransition('succeeded', 'failed')).toBe(false);
  });
});

describe('order creation', () => {
  let db: DbClient;
  let user: { id: string };
  let course: { id: string; slug: string; title: string };

  beforeEach(async () => {
    db = await createTestDb();
    user = await makeUser(db);
    const instructor = await makeUser(db);
    course = await seedCourse(db, {
      createdBy: instructor.id,
      slug: 'checkout-course',
      title: 'Checkout Course',
      priceAmount: '7500.00',
      priceCurrency: 'NGN',
    });
  });

  it('creates order + line item + payment with the course price as authority', async () => {
    const { order, payment } = await newOrder(db, user.id, course.id);

    expect(order.status).toBe('created');
    expect(order.currency).toBe('NGN');
    expect(order.total_amount).toBe('7500.00');
    expect(order.expires_at).toBeInstanceOf(Date);
    expect(order.expires_at!.getTime()).toBeGreaterThan(Date.now());
    expect(payment.status).toBe('initiated');
    expect(payment.amount).toBe('7500.00');
    expect(payment.provider).toBe('simulated');
    expect(payment.provider_reference).toMatch(/^simulated_/);

    const { rows: items } = await db.query<{ title_snapshot: string; unit_amount: string }>(
      'SELECT title_snapshot, unit_amount::text AS unit_amount FROM order_items WHERE order_id = $1',
      [order.id],
    );
    expect(items[0]?.title_snapshot).toBe('Checkout Course');
    expect(items[0]?.unit_amount).toBe('7500.00');

    expect(await auditActions(db)).toContain('order.created');
  });

  it('rejects unpublished courses', async () => {
    const draft = await seedCourse(db, {
      createdBy: (await makeUser(db)).id,
      status: 'draft',
    });
    await expect(newOrder(db, user.id, draft.id)).rejects.toMatchObject({
      code: 'course_not_purchasable',
    });
  });

  it('rejects duplicate purchase when an active entitlement exists', async () => {
    await db.query(
      `INSERT INTO entitlements (user_id, course_id, source) VALUES ($1, $2, 'manual_grant')`,
      [user.id, course.id],
    );
    await expect(newOrder(db, user.id, course.id)).rejects.toMatchObject({
      code: 'duplicate_purchase',
    });
  });
});

describe('abandoned checkout expiry', () => {
  let db: DbClient;
  let user: { id: string };
  let course: { id: string };

  beforeEach(async () => {
    db = await createTestDb();
    user = await makeUser(db);
    const instructor = await makeUser(db);
    course = (await seedCourse(db, { createdBy: instructor.id })).id;
  });

  it('cancels stale open orders, expires their payments and audits', async () => {
    const { order, payment } = await newOrder(db, user.id, course);
    await db.query(
      `UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [order.id],
    );

    const result = await expireStaleOrders(db);
    expect(result.cancelled).toEqual([order.id]);

    const view = await getOwnedOrder(db, order.id, user.id);
    expect(view?.order.status).toBe('cancelled');
    expect(view?.payments[0]?.status).toBe('expired');
    expect(await auditActions(db)).toContain('checkout.expired');

    // Idempotent: nothing left to cancel.
    const again = await expireStaleOrders(db);
    expect(again.cancelled).toEqual([]);
  });

  it('leaves fresh and paid orders untouched', async () => {
    const { order } = await newOrder(db, user.id, course);
    const result = await expireStaleOrders(db);
    expect(result.cancelled).toEqual([]);
    const view = await getOwnedOrder(db, order.id, user.id);
    expect(view?.order.status).toBe('created');
  });
});

describe('payment success handling (single transaction)', () => {
  let db: DbClient;
  let user: { id: string };
  let course: { id: string };
  let order: Awaited<ReturnType<typeof newOrder>>;

  beforeEach(async () => {
    db = await createTestDb();
    user = await makeUser(db);
    const instructor = await makeUser(db);
    course = (await seedCourse(db, { createdBy: instructor.id })).id;
    order = await newOrder(db, user.id, course);
  });

  it('grants entitlement + enrolment and completes the order', async () => {
    const result = await processPaymentSuccess(db, {
      paymentId: order.payment.id,
      orderId: order.order.id,
      userId: user.id,
      courseId: course,
      amount: order.order.total_amount,
      currency: order.order.currency,
      fromPaymentStatus: ['initiated', 'pending', 'failed'],
      fromOrderStatus: ['created', 'payment_pending', 'failed'],
    });
    expect(result).toEqual({ granted: true, alreadyEntitled: false, enrollmentCreated: true });

    const view = await getOwnedOrder(db, order.order.id, user.id);
    expect(view?.order.status).toBe('paid');
    expect(view?.payments[0]?.status).toBe('succeeded');
    expect(view?.payments[0]?.processed_at).toBeInstanceOf(Date);

    const { rows: entitlements } = await db.query<{ source: string; granted_by_payment_id: string }>(
      `SELECT source, granted_by_payment_id FROM entitlements WHERE user_id = $1 AND course_id = $2`,
      [user.id, course],
    );
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]?.source).toBe('purchase');
    expect(entitlements[0]?.granted_by_payment_id).toBe(order.payment.id);

    const enrollments = await listEnrollmentsForUser(db, user.id);
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]?.course_id).toBe(course);
    expect(enrollments[0]?.status).toBe('active');

    const actions = await auditActions(db);
    expect(actions).toContain('payment.succeeded');
    expect(actions).toContain('order.paid');
    expect(actions).toContain('entitlement.granted');
    expect(actions).toContain('enrollment.created');
  });

  it('is idempotent when access already exists (no duplicate rows)', async () => {
    await processPaymentSuccess(db, {
      paymentId: order.payment.id,
      orderId: order.order.id,
      userId: user.id,
      courseId: course,
      amount: order.order.total_amount,
      currency: order.order.currency,
      fromPaymentStatus: ['initiated'],
      fromOrderStatus: ['created'],
    });
    // Second success attempt on the same payment → invalid transition (already applied).
    await expect(
      processPaymentSuccess(db, {
        paymentId: order.payment.id,
        orderId: order.order.id,
        userId: user.id,
        courseId: course,
        amount: order.order.total_amount,
        currency: order.order.currency,
        fromPaymentStatus: ['initiated'],
        fromOrderStatus: ['created'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });

    const { rows: entitlements } = await db.query(
      `SELECT id FROM entitlements WHERE user_id = $1 AND course_id = $2`,
      [user.id, course],
    );
    expect(entitlements).toHaveLength(1);
  });

  it('pre-existing entitlement from a manual grant → alreadyEntitled, still paid', async () => {
    await db.query(
      `INSERT INTO entitlements (user_id, course_id, source) VALUES ($1, $2, 'manual_grant')`,
      [user.id, course],
    );
    const result = await processPaymentSuccess(db, {
      paymentId: order.payment.id,
      orderId: order.order.id,
      userId: user.id,
      courseId: course,
      amount: order.order.total_amount,
      currency: order.order.currency,
      fromPaymentStatus: ['initiated'],
      fromOrderStatus: ['created'],
    });
    expect(result.granted).toBe(false);
    expect(result.alreadyEntitled).toBe(true);

    const actions = await auditActions(db);
    expect(actions).toContain('order.paid');
    expect(actions).not.toContain('entitlement.granted');
  });

  it('withdrawn during checkout → CommerceError and full rollback (no access)', async () => {
    await db.query(`UPDATE courses SET status = 'withdrawn' WHERE id = $1`, [course]);

    await expect(
      processPaymentSuccess(db, {
        paymentId: order.payment.id,
        orderId: order.order.id,
        userId: user.id,
        courseId: course,
        amount: order.order.total_amount,
        currency: order.order.currency,
        fromPaymentStatus: ['initiated'],
        fromOrderStatus: ['created'],
      }),
    ).rejects.toMatchObject({ code: 'course_not_purchasable' });

    const view = await getOwnedOrder(db, order.order.id, user.id);
    expect(view?.order.status).toBe('created');
    expect(view?.payments[0]?.status).toBe('initiated');
    const { rows: entitlements } = await db.query(
      `SELECT id FROM entitlements WHERE user_id = $1 AND course_id = $2`,
      [user.id, course],
    );
    expect(entitlements).toHaveLength(0);
  });

  it('applying success twice concurrently-safe: second guarded update fails cleanly', async () => {
    // First application succeeds; a second with wrong source statuses must not double-grant.
    await processPaymentSuccess(db, {
      paymentId: order.payment.id,
      orderId: order.order.id,
      userId: user.id,
      courseId: course,
      amount: order.order.total_amount,
      currency: order.order.currency,
      fromPaymentStatus: ['initiated'],
      fromOrderStatus: ['created'],
    });
    await expect(
      processPaymentSuccess(db, {
        paymentId: order.payment.id,
        orderId: order.order.id,
        userId: user.id,
        courseId: course,
        amount: order.order.total_amount,
        currency: order.order.currency,
        fromPaymentStatus: ['initiated'],
        fromOrderStatus: ['created'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('revoked entitlement conflict → entitlement_revoked_review (no silent re-grant)', async () => {
    await db.query(
      `INSERT INTO entitlements (user_id, course_id, source, status, revoked_at, revoked_reason)
       VALUES ($1, $2, 'manual_grant', 'revoked', now(), 'prior dispute')`,
      [user.id, course],
    );
    await expect(
      processPaymentSuccess(db, {
        paymentId: order.payment.id,
        orderId: order.order.id,
        userId: user.id,
        courseId: course,
        amount: order.order.total_amount,
        currency: order.order.currency,
        fromPaymentStatus: ['initiated'],
        fromOrderStatus: ['created'],
      }),
    ).rejects.toMatchObject({ code: 'entitlement_revoked_review' });
  });
});

describe('payment failure & refund handling', () => {
  let db: DbClient;
  let user: { id: string };
  let course: { id: string };
  let order: Awaited<ReturnType<typeof newOrder>>;

  beforeEach(async () => {
    db = await createTestDb();
    user = await makeUser(db);
    const instructor = await makeUser(db);
    course = (await seedCourse(db, { createdBy: instructor.id })).id;
    order = await newOrder(db, user.id, course);
  });

  it('marks payment + order failed and audits', async () => {
    await processPaymentFailure(db, {
      paymentId: order.payment.id,
      orderId: order.order.id,
      reason: 'card_declined',
      fromPaymentStatus: ['initiated', 'pending'],
      fromOrderStatus: ['created', 'payment_pending'],
    });
    const view = await getOwnedOrder(db, order.order.id, user.id);
    expect(view?.order.status).toBe('failed');
    expect(view?.payments[0]?.status).toBe('failed');
    expect(await auditActions(db)).toContain('payment.failed');
  });

  it('failure after success is rejected (out of order)', async () => {
    await processPaymentSuccess(db, {
      paymentId: order.payment.id,
      orderId: order.order.id,
      userId: user.id,
      courseId: course,
      amount: order.order.total_amount,
      currency: order.order.currency,
      fromPaymentStatus: ['initiated'],
      fromOrderStatus: ['created'],
    });
    await expect(
      processPaymentFailure(db, {
        paymentId: order.payment.id,
        orderId: order.order.id,
        reason: 'late',
        fromPaymentStatus: ['initiated', 'pending'],
        fromOrderStatus: ['created', 'payment_pending'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('refund moves money state, audits review, and keeps entitlement active', async () => {
    await processPaymentSuccess(db, {
      paymentId: order.payment.id,
      orderId: order.order.id,
      userId: user.id,
      courseId: course,
      amount: order.order.total_amount,
      currency: order.order.currency,
      fromPaymentStatus: ['initiated'],
      fromOrderStatus: ['created'],
    });

    await processRefund(db, {
      paymentId: order.payment.id,
      orderId: order.order.id,
      kind: 'refunded',
      reason: 'provider_chargeback',
      fromPaymentStatus: ['succeeded'],
      fromOrderStatus: ['paid'],
    });

    const view = await getOwnedOrder(db, order.order.id, user.id);
    expect(view?.order.status).toBe('refunded');
    expect(view?.payments[0]?.status).toBe('refunded');

    const { rows: entitlements } = await db.query<{ status: string }>(
      `SELECT status FROM entitlements WHERE user_id = $1 AND course_id = $2`,
      [user.id, course],
    );
    expect(entitlements[0]?.status).toBe('active');

    const { rows: refundEvents } = await db.query<{ metadata: { entitlementReview: string } }>(
      `SELECT metadata FROM audit_events WHERE action = 'payment.refunded'`,
    );
    expect(refundEvents[0]?.metadata.entitlementReview).toBe('required');
  });

  it('refund from a non-paid order is rejected', async () => {
    await expect(
      processRefund(db, {
        paymentId: order.payment.id,
        orderId: order.order.id,
        kind: 'reversed',
        reason: 'provider_reversal',
        fromPaymentStatus: ['succeeded'],
        fromOrderStatus: ['paid'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});

describe('payment events (webhook idempotency)', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('inserts once; duplicates return the original receipt', async () => {
    const first = await insertPaymentEvent(db, {
      provider: 'simulated',
      eventId: 'evt-1',
      eventType: 'payment.succeeded',
      payload: { hello: 'world' },
    });
    expect(first.inserted).toBe(true);
    expect(first.status).toBe('received');

    const second = await insertPaymentEvent(db, {
      provider: 'simulated',
      eventId: 'evt-1',
      eventType: 'payment.succeeded',
      payload: { hello: 'changed' },
    });
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id);

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM payment_events WHERE provider = 'simulated' AND event_id = 'evt-1'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('finishPaymentEvent records the outcome for dedupe responses', async () => {
    const receipt = await insertPaymentEvent(db, {
      provider: 'simulated',
      eventId: 'evt-2',
      eventType: 'payment.failed',
      payload: {},
    });
    await finishPaymentEvent(db, receipt.id, 'processed');
    const repeat = await insertPaymentEvent(db, {
      provider: 'simulated',
      eventId: 'evt-2',
      eventType: 'payment.failed',
      payload: {},
    });
    expect(repeat.inserted).toBe(false);
    expect(repeat.status).toBe('processed');
  });
});

describe('order & enrolment listings', () => {
  let db: DbClient;
  let user: { id: string };
  let other: { id: string };

  beforeEach(async () => {
    db = await createTestDb();
    user = await makeUser(db);
    other = await makeUser(db);
  });

  it('lists orders for the owner only, with course title snapshot', async () => {
    const instructor = await makeUser(db);
    const course = await seedCourse(db, { createdBy: instructor.id, title: 'Owned Course' });
    const mine = await newOrder(db, user.id, course.id);
    await newOrder(db, other.id, course.id);

    const orders = await listOrdersForUser(db, user.id, { limit: 10, offset: 0 });
    expect(orders.total).toBe(1);
    expect(orders.items[0]?.id).toBe(mine.order.id);
    expect(orders.items[0]?.course_title).toBe('Owned Course');
    expect(orders.items[0]?.payment_status).toBe('initiated');
    expect(orders.items[0]?.payment_reference).toMatch(/^simulated_/);

    const notMine = await getOwnedOrder(db, mine.order.id, other.id);
    expect(notMine).toBeNull();
  });

  it('lists enrolments after purchase for the learner', async () => {
    const instructor = await makeUser(db);
    const course = await seedCourse(db, { createdBy: instructor.id, title: 'Enrolled Course' });
    const purchase = await newOrder(db, user.id, course.id);
    await processPaymentSuccess(db, {
      paymentId: purchase.payment.id,
      orderId: purchase.order.id,
      userId: user.id,
      courseId: course.id,
      amount: purchase.order.total_amount,
      currency: purchase.order.currency,
      fromPaymentStatus: ['initiated'],
      fromOrderStatus: ['created'],
    });

    const mine = await listEnrollmentsForUser(db, user.id);
    expect(mine.map((e) => e.course_title)).toEqual(['Enrolled Course']);
    const theirs = await listEnrollmentsForUser(db, other.id);
    expect(theirs).toHaveLength(0);
  });
});

describe('CommerceError', () => {
  it('carries a stable machine-readable code', () => {
    const error = new CommerceError('duplicate_purchase', 'nope');
    expect(error.code).toBe('duplicate_purchase');
    expect(error).toBeInstanceOf(Error);
  });
});
