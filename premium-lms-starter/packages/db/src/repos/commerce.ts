import { randomUUID } from 'node:crypto';
import type { DbClient } from '../client.js';
import type { OrderRow, PaymentRow, PaymentStatus } from '../types.js';
import { insertAuditEvent } from './audit.js';

/**
 * Commerce data access (orders, payments, webhook events, entitlement grants).
 * All multi-row money changes run inside transactions; status updates are
 * guarded (`WHERE status = …`) so concurrent/out-of-order writes cannot skip
 * the state machine.
 */

export type CommerceErrorCode =
  | 'course_not_purchasable'
  | 'course_not_found'
  | 'duplicate_purchase'
  | 'entitlement_revoked_review'
  | 'invalid_transition';

export class CommerceError extends Error {
  constructor(
    readonly code: CommerceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}

const ORDER_COLUMNS = `id, user_id, status, currency, total_amount, idempotency_key,
  expires_at, created_at, updated_at`;
const PAYMENT_COLUMNS = `id, order_id, provider, provider_reference, status, amount, currency,
  processed_at, created_at, updated_at`;

/** Cancel abandoned checkouts (orders past their expiry deadline). */
export async function expireStaleOrders(db: DbClient): Promise<{ cancelled: string[] }> {
  return db.transaction(async (tx) => {
    const { rows: stale } = await tx.query<{ id: string }>(
      `SELECT id FROM orders
        WHERE expires_at IS NOT NULL AND expires_at < now()
          AND (status = 'created' OR status = 'payment_pending')`,
    );
    const cancelled: string[] = [];
    for (const order of stale) {
      const updated = await tx.query<{ id: string }>(
        `UPDATE orders SET status = 'cancelled'
          WHERE id = $1 AND (status = 'created' OR status = 'payment_pending')
          RETURNING id`,
        [order.id],
      );
      if (updated.rowCount === 0) continue;
      await tx.query(
        `UPDATE payments SET status = 'expired'
          WHERE order_id = $1 AND (status = 'initiated' OR status = 'pending')`,
        [order.id],
      );
      await insertAuditEvent(tx, {
        actorUserId: null,
        action: 'checkout.expired',
        targetType: 'order',
        targetId: order.id,
        metadata: { reason: 'checkout_ttl_elapsed' },
      });
      cancelled.push(order.id);
    }
    return { cancelled };
  });
}

export interface CreateOrderInput {
  userId: string;
  provider: string;
  checkoutTtlMinutes: number;
  course: { id: string; slug: string; title: string; price_amount: string; price_currency: string };
}

/**
 * Create an order + line item + payment attempt atomically after re-checking
 * eligibility inside the transaction (published + not already entitled).
 * The price always comes from the course row — never from the client.
 */
export async function createOrder(
  db: DbClient,
  input: CreateOrderInput,
): Promise<{ order: OrderRow; payment: PaymentRow }> {
  return db.transaction(async (tx) => {
    const { rows: courseRows } = await tx.query<{ status: string }>(
      'SELECT status FROM courses WHERE id = $1',
      [input.course.id],
    );
    if (!courseRows[0]) {
      throw new CommerceError('course_not_found', 'Course not found.');
    }
    if (courseRows[0].status !== 'published') {
      throw new CommerceError('course_not_purchasable', 'This course is not available for purchase.');
    }

    const { rows: ownedRows } = await tx.query<{ id: string }>(
      `SELECT id FROM entitlements
        WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
      [input.userId, input.course.id],
    );
    if (ownedRows[0]) {
      throw new CommerceError('duplicate_purchase', 'You already have access to this course.');
    }

    const { rows: orderRows } = await tx.query<OrderRow>(
      `INSERT INTO orders (user_id, status, currency, total_amount, expires_at)
       VALUES ($1, 'created', $2, $3, now() + make_interval(mins => $4))
       RETURNING ${ORDER_COLUMNS}`,
      [
        input.userId,
        input.course.price_currency,
        input.course.price_amount,
        input.checkoutTtlMinutes,
      ],
    );
    const order = orderRows[0];
    if (!order) throw new Error('Order insert returned no row');

    await tx.query(
      `INSERT INTO order_items (order_id, course_id, title_snapshot, unit_amount, quantity)
       VALUES ($1, $2, $3, $4, 1)`,
      [order.id, input.course.id, input.course.title, input.course.price_amount],
    );

    const { rows: paymentRows } = await tx.query<PaymentRow>(
      `INSERT INTO payments (order_id, provider, provider_reference, status, amount, currency)
       VALUES ($1, $2, $3, 'initiated', $4, $5)
       RETURNING ${PAYMENT_COLUMNS}`,
      [
        order.id,
        input.provider,
        `${input.provider}_${randomUUID()}`,
        input.course.price_amount,
        input.course.price_currency,
      ],
    );
    const payment = paymentRows[0];
    if (!payment) throw new Error('Payment insert returned no row');

    await insertAuditEvent(tx, {
      actorUserId: input.userId,
      action: 'order.created',
      targetType: 'order',
      targetId: order.id,
      metadata: {
        courseId: input.course.id,
        courseSlug: input.course.slug,
        amount: input.course.price_amount,
        currency: input.course.price_currency,
        paymentId: payment.id,
      },
    });

    return { order, payment };
  });
}

/** Guarded status change: only applies when the row is still in `from`. */
export async function setOrderStatus(
  db: DbClient,
  input: { orderId: string; from: string; to: string },
): Promise<OrderRow | null> {
  const { rows } = await db.query<OrderRow>(
    `UPDATE orders SET status = $3 WHERE id = $1 AND status = $2 RETURNING ${ORDER_COLUMNS}`,
    [input.orderId, input.from, input.to],
  );
  return rows[0] ?? null;
}

export async function setPaymentStatus(
  db: DbClient,
  input: { paymentId: string; from: PaymentStatus; to: PaymentStatus; markProcessed?: boolean },
): Promise<PaymentRow | null> {
  const { rows } = await db.query<PaymentRow>(
    `UPDATE payments
        SET status = $3,
            processed_at = CASE WHEN $4::boolean THEN now() ELSE processed_at END
      WHERE id = $1 AND status = $2
      RETURNING ${PAYMENT_COLUMNS}`,
    [input.paymentId, input.from, input.to, input.markProcessed ?? false],
  );
  return rows[0] ?? null;
}

export async function findPaymentByReference(
  db: DbClient,
  provider: string,
  providerReference: string,
): Promise<PaymentRow | null> {
  const { rows } = await db.query<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE provider = $1 AND provider_reference = $2`,
    [provider, providerReference],
  );
  return rows[0] ?? null;
}

export async function getOrderById(db: DbClient, orderId: string): Promise<OrderRow | null> {
  const { rows } = await db.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [
    orderId,
  ]);
  return rows[0] ?? null;
}

/**
 * The caller's most recent unexpired open checkout for a course (created /
 * payment_pending). Used to keep at most one live checkout per user+course.
 */
export async function findOpenOrderForCourse(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<OrderRow | null> {
  const { rows: orders } = await db.query<OrderRow>(
    `SELECT o.id, o.user_id, o.status, o.currency, o.total_amount, o.idempotency_key,
            o.expires_at, o.created_at, o.updated_at
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = $1 AND oi.course_id = $2
        AND (o.status = 'created' OR o.status = 'payment_pending')
        AND o.expires_at IS NOT NULL AND o.expires_at > now()
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [userId, courseId],
  );
  return orders[0] ?? null;
}

export interface OwnedOrderView {
  order: OrderRow;
  course_slug: string;
  course_title: string;
  payments: PaymentRow[];
}

/** Order + its course + all payment attempts, scoped to its owner. */
export async function getOwnedOrder(
  db: DbClient,
  orderId: string,
  userId: string,
): Promise<OwnedOrderView | null> {
  const { rows: orderRows } = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 AND user_id = $2`,
    [orderId, userId],
  );
  const order = orderRows[0];
  if (!order) return null;

  const { rows: courseRows } = await db.query<{ slug: string; title: string }>(
    `SELECT c.slug, oi.title_snapshot AS title
       FROM order_items oi JOIN courses c ON c.id = oi.course_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at
      LIMIT 1`,
    [orderId],
  );
  const { rows: paymentRows } = await db.query<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE order_id = $1 ORDER BY created_at`,
    [orderId],
  );

  return {
    order,
    course_slug: courseRows[0]?.slug ?? '',
    course_title: courseRows[0]?.title ?? '',
    payments: paymentRows,
  };
}

/** Same as getOwnedOrder but located by payment reference (checkout page). */
export async function getOwnedOrderByPaymentRef(
  db: DbClient,
  provider: string,
  providerReference: string,
  userId: string,
): Promise<OwnedOrderView | null> {
  const { rows } = await db.query<{ order_id: string }>(
    `SELECT order_id FROM payments WHERE provider = $1 AND provider_reference = $2`,
    [provider, providerReference],
  );
  const orderId = rows[0]?.order_id;
  if (!orderId) return null;
  return getOwnedOrder(db, orderId, userId);
}

export interface UserOrderListItem extends OrderRow {
  course_slug: string | null;
  course_title: string | null;
  payment_status: PaymentStatus | null;
  payment_reference: string | null;
}

export async function listOrdersForUser(
  db: DbClient,
  userId: string,
  options: { limit: number; offset: number },
): Promise<{ items: UserOrderListItem[]; total: number }> {
  const limit = Math.min(Math.max(options.limit, 1), 100);
  const offset = Math.max(options.offset, 0);

  const { rows: countRows } = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM orders WHERE user_id = $1',
    [userId],
  );
  const { rows } = await db.query<UserOrderListItem>(
    `SELECT o.id, o.user_id, o.status, o.currency, o.total_amount, o.idempotency_key,
            o.expires_at, o.created_at, o.updated_at,
            (SELECT c.slug FROM order_items oi JOIN courses c ON c.id = oi.course_id
              WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1) AS course_slug,
            (SELECT oi.title_snapshot FROM order_items oi
              WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1) AS course_title,
            (SELECT p.status FROM payments p WHERE p.order_id = o.id
              ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
            (SELECT p.provider_reference FROM payments p WHERE p.order_id = o.id
              ORDER BY p.created_at DESC LIMIT 1) AS payment_reference
       FROM orders o
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return { items: rows, total: Number(countRows[0]?.count ?? 0) };
}

// ---------------------------------------------------------------------------
// Webhook events (idempotent receipts)
// ---------------------------------------------------------------------------

export type PaymentEventOutcome = 'received' | 'processed' | 'ignored' | 'quarantined';

export async function insertPaymentEvent(
  db: DbClient,
  input: {
    provider: string;
    eventId: string;
    eventType: string | null;
    payload: unknown;
  },
): Promise<{ id: string; inserted: boolean; status: PaymentEventOutcome }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO payment_events (provider, event_id, event_type, payload, status)
     VALUES ($1, $2, $3, $4::jsonb, 'received')
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [input.provider, input.eventId, input.eventType, JSON.stringify(input.payload ?? {})],
  );
  if (rows[0]) return { id: rows[0].id, inserted: true, status: 'received' };

  const { rows: existing } = await db.query<{ id: string; status: PaymentEventOutcome }>(
    `SELECT id, status FROM payment_events WHERE provider = $1 AND event_id = $2`,
    [input.provider, input.eventId],
  );
  const row = existing[0];
  if (!row) throw new Error('Payment event conflict resolved without a row');
  return { id: row.id, inserted: false, status: row.status };
}

export async function finishPaymentEvent(
  db: DbClient,
  id: string,
  status: Exclude<PaymentEventOutcome, 'received'>,
): Promise<void> {
  await db.query(
    `UPDATE payment_events SET status = $2, processed_at = now() WHERE id = $1`,
    [id, status],
  );
}

// ---------------------------------------------------------------------------
// Entitlement / enrolment grants
// ---------------------------------------------------------------------------

export async function findActiveEntitlement(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<{ id: string; status: string } | null> {
  const { rows } = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM entitlements WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId],
  );
  return rows[0] ?? null;
}

export interface PaymentSuccessResult {
  granted: boolean;
  alreadyEntitled: boolean;
  enrollmentCreated: boolean;
}

/**
 * Verified-successful-payment handler: payment → succeeded, order → paid,
 * entitlement + enrolment created (all in ONE transaction). Returns whether a
 * NEW entitlement was granted (false = caller already had access).
 * Throws CommerceError:
 *  - course_not_purchasable (withdrawn during checkout → caller quarantines)
 *  - entitlement_revoked_review (existing revoked entitlement → reconcile)
 *  - invalid_transition (guarded update lost a race)
 */
export async function processPaymentSuccess(
  db: DbClient,
  input: {
    paymentId: string;
    orderId: string;
    userId: string;
    courseId: string;
    amount: string;
    currency: string;
    fromPaymentStatus: readonly string[];
    fromOrderStatus: readonly string[];
  },
): Promise<PaymentSuccessResult> {
  return db.transaction(async (tx) => {
    // Re-check sale eligibility inside the transaction (withdrawal race).
    const { rows: courseRows } = await tx.query<{ status: string }>(
      'SELECT status FROM courses WHERE id = $1',
      [input.courseId],
    );
    if (!courseRows[0]) {
      throw new CommerceError('course_not_found', 'Course no longer exists.');
    }
    if (courseRows[0].status !== 'published') {
      throw new CommerceError(
        'course_not_purchasable',
        'Course became unavailable during checkout; payment quarantined for reconciliation.',
      );
    }

    const payment = await tx.query<{ id: string }>(
      `UPDATE payments SET status = 'succeeded', processed_at = now()
        WHERE id = $1 AND status = ANY($2::text[])
        RETURNING id`,
      [input.paymentId, [...input.fromPaymentStatus]],
    );
    if (!payment.rows[0]) {
      throw new CommerceError('invalid_transition', 'Payment is not in an applicable state.');
    }

    const order = await tx.query<OrderRow>(
      `UPDATE orders SET status = 'paid'
        WHERE id = $1 AND status = ANY($2::text[])
        RETURNING id, user_id, status, currency, total_amount, idempotency_key, expires_at,
                  created_at, updated_at`,
      [input.orderId, [...input.fromOrderStatus]],
    );
    if (!order.rows[0]) {
      throw new CommerceError('invalid_transition', 'Order is not in an applicable state.');
    }

    // Entitlement: one per user+course. Revoked conflict needs human policy (O-20).
    const { rows: existingEntitlement } = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM entitlements WHERE user_id = $1 AND course_id = $2`,
      [input.userId, input.courseId],
    );
    let granted = false;
    if (existingEntitlement[0]) {
      if (existingEntitlement[0].status !== 'active') {
        throw new CommerceError(
          'entitlement_revoked_review',
          'A revoked entitlement exists for this purchase; manual reconciliation required.',
        );
      }
    } else {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO entitlements (user_id, course_id, source, granted_by_payment_id)
         VALUES ($1, $2, 'purchase', $3)
         RETURNING id`,
        [input.userId, input.courseId, input.paymentId],
      );
      if (!inserted.rows[0]) {
        throw new Error('Entitlement insert returned no row');
      }
      granted = true;
    }

    const enrollment = await tx.query<{ id: string }>(
      `INSERT INTO enrollments (user_id, course_id, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (user_id, course_id) DO NOTHING
       RETURNING id`,
      [input.userId, input.courseId],
    );
    const enrollmentCreated = Boolean(enrollment.rows[0]);

    await insertAuditEvent(tx, {
      actorUserId: input.userId,
      action: 'payment.succeeded',
      targetType: 'payment',
      targetId: input.paymentId,
      metadata: { orderId: input.orderId, amount: input.amount, currency: input.currency },
    });
    await insertAuditEvent(tx, {
      actorUserId: input.userId,
      action: 'order.paid',
      targetType: 'order',
      targetId: input.orderId,
      metadata: { paymentId: input.paymentId },
    });
    if (granted) {
      await insertAuditEvent(tx, {
        actorUserId: input.userId,
        action: 'entitlement.granted',
        targetType: 'course',
        targetId: input.courseId,
        metadata: { source: 'purchase', paymentId: input.paymentId, orderId: input.orderId },
      });
    }
    if (enrollmentCreated) {
      await insertAuditEvent(tx, {
        actorUserId: input.userId,
        action: 'enrollment.created',
        targetType: 'course',
        targetId: input.courseId,
        metadata: { orderId: input.orderId },
      });
    }

    return { granted, alreadyEntitled: !granted, enrollmentCreated };
  });
}

export async function processPaymentFailure(
  db: DbClient,
  input: {
    paymentId: string;
    orderId: string;
    reason: string;
    fromPaymentStatus: readonly string[];
    fromOrderStatus: readonly string[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const payment = await tx.query<{ id: string }>(
      `UPDATE payments SET status = 'failed', processed_at = now()
        WHERE id = $1 AND status = ANY($2::text[])
        RETURNING id`,
      [input.paymentId, [...input.fromPaymentStatus]],
    );
    if (!payment.rows[0]) {
      throw new CommerceError('invalid_transition', 'Payment is not in an applicable state.');
    }
    const order = await tx.query<{ id: string }>(
      `UPDATE orders SET status = 'failed'
        WHERE id = $1 AND status = ANY($2::text[])
        RETURNING id`,
      [input.orderId, [...input.fromOrderStatus]],
    );
    if (!order.rows[0]) {
      throw new CommerceError('invalid_transition', 'Order is not in an applicable state.');
    }
    await insertAuditEvent(tx, {
      actorUserId: null,
      action: 'payment.failed',
      targetType: 'payment',
      targetId: input.paymentId,
      metadata: { orderId: input.orderId, reason: input.reason },
    });
  });
}

/**
 * Refund/reversal handling: transitions money records and audits a required
 * entitlement review. Does NOT revoke access — revocation policy is open (O-20).
 */
export async function processRefund(
  db: DbClient,
  input: {
    paymentId: string;
    orderId: string;
    kind: 'refunded' | 'reversed';
    reason: string;
    fromPaymentStatus: readonly string[];
    fromOrderStatus: readonly string[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const payment = await tx.query<{ id: string }>(
      `UPDATE payments SET status = $3
        WHERE id = $1 AND status = ANY($2::text[])
        RETURNING id`,
      [input.paymentId, [...input.fromPaymentStatus], input.kind],
    );
    if (!payment.rows[0]) {
      throw new CommerceError('invalid_transition', 'Payment is not in an applicable state.');
    }
    const order = await tx.query<{ id: string }>(
      `UPDATE orders SET status = $3
        WHERE id = $1 AND status = ANY($2::text[])
        RETURNING id`,
      [input.orderId, [...input.fromOrderStatus], input.kind],
    );
    if (!order.rows[0]) {
      throw new CommerceError('invalid_transition', 'Order is not in an applicable state.');
    }
    await insertAuditEvent(tx, {
      actorUserId: null,
      action: `payment.${input.kind}`,
      targetType: 'payment',
      targetId: input.paymentId,
      metadata: {
        orderId: input.orderId,
        reason: input.reason,
        entitlementReview: 'required',
        entitlementChanged: false,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Enrolment reads (student library / dashboard)
// ---------------------------------------------------------------------------

export interface EnrollmentListItem {
  enrollment_id: string;
  course_id: string;
  course_slug: string;
  course_title: string;
  course_status: string;
  status: string;
  enrolled_at: Date;
  completed_at: Date | null;
  price_amount: string;
  price_currency: string;
}

export async function listEnrollmentsForUser(
  db: DbClient,
  userId: string,
): Promise<EnrollmentListItem[]> {
  const { rows } = await db.query<EnrollmentListItem>(
    `SELECT e.id AS enrollment_id, c.id AS course_id, c.slug AS course_slug,
            c.title AS course_title, c.status AS course_status,
            e.status, e.enrolled_at, e.completed_at,
            c.price_amount::text AS price_amount, c.price_currency
       FROM enrollments e JOIN courses c ON c.id = e.course_id
      WHERE e.user_id = $1
      ORDER BY e.enrolled_at DESC`,
    [userId],
  );
  return rows;
}

