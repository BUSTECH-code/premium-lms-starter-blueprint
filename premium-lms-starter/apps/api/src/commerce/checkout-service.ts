import { randomUUID } from 'node:crypto';
import {
  CommerceError,
  createOrder,
  expireStaleOrders,
  findActiveEntitlement,
  getCourseBySlug,
  getOwnedOrderByPaymentRef,
  getOwnedOrder,
  insertAuditEvent,
  setOrderStatus,
  setPaymentStatus,
  type DbClient,
  type OwnedOrderView,
  type PaymentRow,
} from '@lms/db';
import type { Env } from '../config/env.js';
import { errors } from '../lib/errors.js';
import type { PaymentProvider } from '../payments/provider.js';
import { normaliseAmount, type PaymentEventType } from './events.js';
import { processPaymentWebhook, type WebhookResult } from './webhook-service.js';

export interface CheckoutDeps {
  env: Env;
  db: DbClient;
  provider: PaymentProvider;
}

export interface CheckoutView {
  order: {
    id: string;
    status: string;
    currency: string;
    totalAmount: string;
    expiresAt: Date | null;
    createdAt: Date;
  };
  course: { slug: string; title: string };
  payment: {
    id: string;
    status: string;
    provider: string;
    providerReference: string;
    amount: string;
    currency: string;
  } | null;
}

export function toCheckoutView(view: OwnedOrderView): CheckoutView {
  const latest = view.payments[view.payments.length - 1] ?? null;
  return {
    order: {
      id: view.order.id,
      status: view.order.status,
      currency: view.order.currency,
      totalAmount: view.order.total_amount,
      expiresAt: view.order.expires_at,
      createdAt: view.order.created_at,
    },
    course: { slug: view.course_slug, title: view.course_title },
    payment: latest
      ? {
          id: latest.id,
          status: latest.status,
          provider: latest.provider,
          providerReference: latest.provider_reference ?? '',
          amount: latest.amount,
          currency: latest.currency,
        }
      : null,
  };
}

async function loadCourseForPurchase(db: DbClient, courseSlug: string) {
  const course = await getCourseBySlug(db, courseSlug);
  if (!course) {
    throw errors.notFound('course_not_found', 'Course not found.');
  }
  return course;
}

/**
 * Start (or resume) a checkout for a published course.
 * - Server is the price authority: the amount comes from the course row.
 * - Duplicate purchase is blocked up front (409) when an active entitlement
 *   exists; an unexpired open checkout for the same course is reused instead
 *   of stacking parallel orders.
 */
export async function createCheckout(
  deps: CheckoutDeps,
  userId: string,
  courseSlug: string,
): Promise<{ view: CheckoutView; reused: boolean }> {
  const { db } = deps;
  const course = await loadCourseForPurchase(db, courseSlug);

  if (course.status !== 'published') {
    throw errors.conflict(
      'course_not_purchasable',
      'This course is not available for purchase.',
    );
  }
  const entitlement = await findActiveEntitlement(db, userId, course.id);
  if (entitlement?.status === 'active') {
    throw errors.conflict('already_owned', 'You already have access to this course.');
  }

  // Sweep abandoned checkouts first so a stale open order never blocks a new one.
  await expireStaleOrders(db);

  const { rows: openRows } = await db.query<{ id: string }>(
    `SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = $1 AND oi.course_id = $2
        AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.provider = $3)
        AND (o.status = 'created' OR o.status = 'payment_pending')
        AND o.expires_at IS NOT NULL AND o.expires_at > now()
      ORDER BY o.created_at DESC LIMIT 1`,
    [userId, course.id, deps.provider.name],
  );
  const openId = openRows[0]?.id;
  if (openId) {
    const existing = await getOwnedOrder(db, openId, userId);
    if (existing) return { view: toCheckoutView(existing), reused: true };
  }

  try {
    const { order } = await createOrder(db, {
      userId,
      provider: deps.provider.name,
      checkoutTtlMinutes: deps.env.commerce.checkoutTtlMinutes,
      course: {
        id: course.id,
        slug: course.slug,
        title: course.title,
        price_amount: course.price_amount,
        price_currency: course.price_currency,
      },
    });
    const created = await getOwnedOrder(db, order.id, userId);
    if (!created) throw errors.internal('Order disappeared after creation.');
    return { view: toCheckoutView(created), reused: false };
  } catch (error) {
    if (error instanceof CommerceError) {
      if (error.code === 'duplicate_purchase') {
        throw errors.conflict('already_owned', error.message);
      }
      if (error.code === 'course_not_purchasable') {
        throw errors.conflict('course_not_purchasable', error.message);
      }
      if (error.code === 'course_not_found') {
        throw errors.notFound('course_not_found', error.message);
      }
    }
    throw error;
  }
}

/** Owner cancels their own open checkout (abandoned-checkout control). */
export async function cancelCheckout(
  deps: CheckoutDeps,
  userId: string,
  orderId: string,
): Promise<CheckoutView> {
  const { db } = deps;
  const view = await getOwnedOrder(db, orderId, userId);
  if (!view) {
    throw errors.notFound('order_not_found', 'Order not found.');
  }
  if (view.order.status !== 'created' && view.order.status !== 'payment_pending') {
    throw errors.conflict('order_not_open', 'This order can no longer be cancelled.');
  }

  const cancelled = await setOrderStatus(db, {
    orderId,
    from: view.order.status,
    to: 'cancelled',
  });
  if (!cancelled) {
    throw errors.conflict('order_not_open', 'This order can no longer be cancelled.');
  }
  for (const payment of view.payments) {
    if (payment.status === 'initiated' || payment.status === 'pending') {
      await setPaymentStatus(db, {
        paymentId: payment.id,
        from: payment.status,
        to: 'expired',
      });
    }
  }
  await insertAuditEvent(db, {
    actorUserId: userId,
    action: 'order.cancelled',
    targetType: 'order',
    targetId: orderId,
    metadata: { courseId: null, by: 'owner' },
  });

  const updated = await getOwnedOrder(db, orderId, userId);
  if (!updated) throw errors.internal('Order disappeared after cancellation.');
  return toCheckoutView(updated);
}

export interface SimulatedCompletionResult extends WebhookResult {
  eventId: string;
  eventType: PaymentEventType;
  checkout: CheckoutView;
}

/**
 * In-app simulated checkout completion. Builds a provider-style signed event
 * and runs it through the SAME webhook pipeline as an external gateway POST —
 * there is no direct grant path anywhere else.
 */
export async function completeSimulatedCheckout(
  deps: CheckoutDeps,
  userId: string,
  providerReference: string,
  outcome: 'success' | 'failure',
): Promise<SimulatedCompletionResult> {
  const { db } = deps;
  const view = await getOwnedOrderByPaymentRef(
    db,
    deps.provider.name,
    providerReference,
    userId,
  );
  if (!view) {
    throw errors.notFound('checkout_not_found', 'Checkout session not found.');
  }

  const isOpen =
    view.order.status === 'created' ||
    view.order.status === 'payment_pending' ||
    // A failed order stays retryable: the provider may deliver a late success
    // (state machine allows failed → paid).
    view.order.status === 'failed';

  // Expired OPEN sessions are swept before we consider paying. Failed orders
  // are not swept (expiry only cancels unpaid attempts), so late corrections
  // remain possible.
  if (
    (view.order.status === 'created' || view.order.status === 'payment_pending') &&
    view.order.expires_at &&
    view.order.expires_at.getTime() <= Date.now()
  ) {
    await expireStaleOrders(db);
    throw errors.conflict('checkout_expired', 'This checkout has expired.');
  }
  if (!isOpen) {
    // Idempotent: paying an already-paid order just reports the current state.
    if (view.order.status === 'paid') {
      const payment = findPayment(view.payments, providerReference);
      return {
        status: 'processed',
        reason: 'already_paid',
        eventId: '',
        eventType: 'payment.succeeded',
        paymentStatus: payment?.status ?? 'succeeded',
        orderStatus: 'paid',
        granted: false,
        enrollmentCreated: false,
        checkout: toCheckoutView(view),
      };
    }
    throw errors.conflict('checkout_not_open', 'This checkout is no longer payable.');
  }

  const payment = findPayment(view.payments, providerReference);
  if (!payment) {
    throw errors.notFound('checkout_not_found', 'Payment attempt not found.');
  }
  const paymentRetryable =
    payment.status === 'initiated' || payment.status === 'pending' || payment.status === 'failed';
  if (!paymentRetryable) {
    throw errors.conflict('checkout_not_open', 'This checkout is no longer payable.');
  }

  const eventType: PaymentEventType =
    outcome === 'success' ? 'payment.succeeded' : 'payment.failed';
  const event = {
    id: `evt_sim_${randomUUID()}`,
    type: eventType,
    created: new Date().toISOString(),
    data: {
      payment: {
        reference: providerReference,
        amount: normaliseAmount(payment.amount),
        currency: payment.currency,
      },
    },
  };

  const rawBody = Buffer.from(JSON.stringify(event), 'utf8');
  const signature = deps.provider.sign(rawBody);
  const result = await processPaymentWebhook({ db, provider: deps.provider }, rawBody, signature);

  const refreshed = await getOwnedOrder(db, view.order.id, userId);
  if (!refreshed) throw errors.internal('Order disappeared during checkout.');

  return {
    ...result,
    eventId: event.id,
    eventType,
    checkout: toCheckoutView(refreshed),
  };
}

function findPayment(payments: PaymentRow[], reference: string): PaymentRow | undefined {
  return payments.find((payment) => payment.provider_reference === reference);
}
