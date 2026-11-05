import type { DbClient } from '@lms/db';
import {
  CommerceError,
  ORDER_FAILURE_SOURCES,
  ORDER_PAID_SOURCES,
  ORDER_REFUND_SOURCES,
  PAYMENT_FAILURE_SOURCES,
  PAYMENT_SUCCEEDED_SOURCES,
  PAYMENT_REFUND_SOURCES,
  finishPaymentEvent,
  findPaymentByReference,
  getOrderById,
  insertPaymentEvent,
  processPaymentFailure,
  processPaymentSuccess,
  processRefund,
} from '@lms/db';
import type { PaymentProvider } from '../payments/provider.js';
import { AppError, errors } from '../lib/errors.js';
import { normaliseAmount, paymentEventSchema, type PaymentEvent } from './events.js';

/**
 * Webhook processing pipeline (single code path for provider POSTs and the
 * in-app simulated checkout):
 *
 *   verify signature → parse event → idempotent receipt (payment_events) →
 *   locate payment + re-validate money facts → apply state machine in one
 *   transaction → record outcome on the receipt.
 *
 * Outcomes recorded on the receipt and returned to the caller:
 *  - processed:   state applied (or provably already applied — idempotent)
 *  - duplicate:   same event id seen before; nothing reprocessed
 *  - ignored:     acknowledged, deliberately not applied (out-of-order event)
 *  - quarantined: needs human reconciliation (unknown reference, money
 *                 mismatch, withdrawn course, revoked entitlement, expiry
 *                 races). Never grants access; HTTP layer still answers 200 so
 *                 the provider stops retrying a deterministic condition.
 */

export type WebhookStatus = 'processed' | 'duplicate' | 'ignored' | 'quarantined';

export interface WebhookResult {
  status: WebhookStatus;
  reason?: string;
  paymentStatus?: string;
  orderStatus?: string;
  /** Present on processed payment.succeeded events. */
  granted?: boolean;
  enrollmentCreated?: boolean;
}

export interface WebhookDeps {
  db: DbClient;
  provider: PaymentProvider;
}

async function readState(
  db: DbClient,
  paymentId: string,
  orderId: string,
): Promise<{ paymentStatus: string; orderStatus: string }> {
  const { rows: paymentRows } = await db.query<{ status: string }>(
    'SELECT status FROM payments WHERE id = $1',
    [paymentId],
  );
  const { rows: orderRows } = await db.query<{ status: string }>(
    'SELECT status FROM orders WHERE id = $1',
    [orderId],
  );
  return {
    paymentStatus: paymentRows[0]?.status ?? 'unknown',
    orderStatus: orderRows[0]?.status ?? 'unknown',
  };
}

function quarantine(reason: string): WebhookResult {
  return { status: 'quarantined', reason };
}

async function handleSucceeded(
  deps: WebhookDeps,
  paymentId: string,
  orderId: string,
  userId: string,
  courseId: string,
  amount: string,
  currency: string,
): Promise<WebhookResult> {
  try {
    const result = await processPaymentSuccess(deps.db, {
      paymentId,
      orderId,
      userId,
      courseId,
      amount,
      currency,
      fromPaymentStatus: PAYMENT_SUCCEEDED_SOURCES,
      fromOrderStatus: ORDER_PAID_SOURCES,
    });
    const state = await readState(deps.db, paymentId, orderId);
    return {
      status: 'processed',
      paymentStatus: state.paymentStatus,
      orderStatus: state.orderStatus,
      granted: result.granted,
      enrollmentCreated: result.enrollmentCreated,
    };
  } catch (error) {
    if (error instanceof CommerceError) {
      if (error.code === 'invalid_transition') {
        const state = await readState(deps.db, paymentId, orderId);
        if (state.paymentStatus === 'succeeded' && state.orderStatus === 'paid') {
          // Duplicate success delivery for an already-completed payment.
          return {
            status: 'processed',
            reason: 'already_applied',
            paymentStatus: state.paymentStatus,
            orderStatus: state.orderStatus,
            granted: false,
            enrollmentCreated: false,
          };
        }
        return { ...quarantine(`invalid_transition:${error.message}`), ...state };
      }
      return { ...quarantine(error.code), ...(await readState(deps.db, paymentId, orderId)) };
    }
    throw error;
  }
}

async function handleFailed(
  deps: WebhookDeps,
  paymentId: string,
  orderId: string,
  reason: string,
): Promise<WebhookResult> {
  try {
    await processPaymentFailure(deps.db, {
      paymentId,
      orderId,
      reason,
      fromPaymentStatus: PAYMENT_FAILURE_SOURCES,
      fromOrderStatus: ORDER_FAILURE_SOURCES,
    });
    const state = await readState(deps.db, paymentId, orderId);
    return { status: 'processed', ...state };
  } catch (error) {
    if (error instanceof CommerceError && error.code === 'invalid_transition') {
      const state = await readState(deps.db, paymentId, orderId);
      if (state.paymentStatus === 'failed') {
        return { status: 'processed', reason: 'already_applied', ...state };
      }
      if (state.paymentStatus === 'succeeded') {
        // Precedence: a success already granted access; a late failure must
        // never take that away through the failure path.
        return { status: 'ignored', reason: 'failure_after_success', ...state };
      }
      return { ...quarantine(`invalid_transition:${error.message}`), ...state };
    }
    throw error;
  }
}

async function handleRefund(
  deps: WebhookDeps,
  paymentId: string,
  orderId: string,
  kind: 'refunded' | 'reversed',
  reason: string,
): Promise<WebhookResult> {
  try {
    await processRefund(deps.db, {
      paymentId,
      orderId,
      kind,
      reason,
      fromPaymentStatus: PAYMENT_REFUND_SOURCES,
      fromOrderStatus: ORDER_REFUND_SOURCES,
    });
    const state = await readState(deps.db, paymentId, orderId);
    // Entitlement deliberately untouched (O-20 open); audit says review needed.
    return { status: 'processed', ...state };
  } catch (error) {
    if (error instanceof CommerceError && error.code === 'invalid_transition') {
      const state = await readState(deps.db, paymentId, orderId);
      if (state.paymentStatus === kind) {
        return { status: 'processed', reason: 'already_applied', ...state };
      }
      if (state.paymentStatus !== 'succeeded') {
        // Refund/reversal for money that never settled — acknowledge, skip.
        return { status: 'ignored', reason: `not_captured:${state.paymentStatus}`, ...state };
      }
      return { ...quarantine(`invalid_transition:${error.message}`), ...state };
    }
    throw error;
  }
}

/**
 * Full pipeline entry point. `rawBody` must be the exact bytes that were
 * signed — never a re-serialised object.
 */
export async function processPaymentWebhook(
  deps: WebhookDeps,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<WebhookResult> {
  if (!deps.provider.verify(rawBody, signature)) {
    throw errors.unauthorized('invalid_signature', 'Webhook signature is invalid.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError(400, 'invalid_event', 'Webhook body is not valid JSON.');
  }
  const eventResult = paymentEventSchema.safeParse(parsed);
  if (!eventResult.success) {
    throw new AppError(400, 'invalid_event', 'Webhook event does not match the event schema.');
  }
  const event: PaymentEvent = eventResult.data;

  // Idempotent receipt: the same event id never processes twice.
  const receipt = await insertPaymentEvent(deps.db, {
    provider: deps.provider.name,
    eventId: event.id,
    eventType: event.type,
    payload: parsed,
  });
  if (!receipt.inserted) {
    // Exact event-id replay: never reprocessed; report the prior outcome.
    return { status: 'duplicate', reason: `previously_${receipt.status}` };
  }

  let result: WebhookResult;
  try {
    result = await dispatch(deps, event);
  } catch (error) {
    await finishPaymentEvent(deps.db, receipt.id, 'quarantined');
    throw error;
  }

  // dispatch never returns 'duplicate' (that case returned earlier) — narrow
  // the receipt outcome to the persisted statuses.
  const finalStatus =
    result.status === 'duplicate' ? ('processed' as const) : result.status;
  await finishPaymentEvent(deps.db, receipt.id, finalStatus);
  return result;
}

async function dispatch(deps: WebhookDeps, event: PaymentEvent): Promise<WebhookResult> {
  const { db } = deps;
  const reference = event.data.payment.reference;

  const payment = await findPaymentByReference(db, deps.provider.name, reference);
  if (!payment) {
    return quarantine('unknown_payment_reference');
  }

  // Money facts must match our own records exactly — never trust the payload.
  let expectedAmount: string;
  try {
    expectedAmount = normaliseAmount(event.data.payment.amount);
  } catch {
    return quarantine('invalid_amount');
  }
  if (expectedAmount !== payment.amount) {
    return quarantine('amount_mismatch');
  }
  if (event.data.payment.currency !== payment.currency) {
    return quarantine('currency_mismatch');
  }

  const { rows: orderRows } = await db.query<{ user_id: string; course_id: string | null }>(
    `SELECT o.user_id, (SELECT oi.course_id FROM order_items oi WHERE oi.order_id = o.id
                          ORDER BY oi.created_at LIMIT 1) AS course_id
       FROM orders o WHERE o.id = $1`,
    [payment.order_id],
  );
  const order = orderRows[0];
  if (!order || !order.course_id) {
    return quarantine('order_not_found');
  }

  switch (event.type) {
    case 'payment.succeeded':
      return handleSucceeded(
        deps,
        payment.id,
        payment.order_id,
        order.user_id,
        order.course_id,
        payment.amount,
        payment.currency,
      );
    case 'payment.failed':
      return handleFailed(deps, payment.id, payment.order_id, event.id);
    case 'payment.refunded':
      return handleRefund(deps, payment.id, payment.order_id, 'refunded', event.id);
    case 'payment.reversed':
      return handleRefund(deps, payment.id, payment.order_id, 'reversed', event.id);
    default: {
      const exhaustive: never = event.type;
      return { status: 'ignored', reason: `unknown_type:${String(exhaustive)}` };
    }
  }
}

/** Used by the simulated checkout to report order state after an event. */
export async function loadOrderStatus(db: DbClient, orderId: string): Promise<string | null> {
  const order = await getOrderById(db, orderId);
  return order?.status ?? null;
}
