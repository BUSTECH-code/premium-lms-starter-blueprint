import type { OrderStatus, PaymentStatus } from '../types.js';

/**
 * Order / payment state transitions — derived from
 * docs/architecture/state-machines.md and docs/workflows/purchase-and-enrolment.md.
 *
 * Precedence rules (webhook events may arrive more than once or out of order):
 * - `payment.succeeded` is authoritative money-in: allowed from initiated,
 *   pending or failed (a late success after a failure still grants access).
 * - Terminal money-out states (expired, reversed, refunded) never grant.
 * - Duplicate `payment.succeeded` is idempotent, not a transition.
 * - `failed` after `succeeded` is out of order and must be ignored.
 * - Refund/reversal never touches entitlements here — revocation policy is an
 *   open decision (O-20); the event is audited for review instead.
 */

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ['payment_pending', 'cancelled', 'failed'],
  payment_pending: ['paid', 'failed', 'cancelled'],
  paid: ['partially_refunded', 'refunded', 'reversed'],
  failed: ['paid'], // late-success precedence
  cancelled: [],
  partially_refunded: ['refunded', 'reversed'],
  refunded: [],
  reversed: [],
};

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  initiated: ['pending', 'failed', 'expired', 'succeeded'],
  pending: ['succeeded', 'failed', 'expired'],
  succeeded: ['refunded', 'reversed'],
  failed: ['succeeded'], // late-success precedence
  expired: [], // late success after expiry → reconciliation (no auto-grant)
  reversed: [],
  refunded: [],
};

export function canOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Statuses from which a payment.succeeded event may be applied. */
export const PAYMENT_SUCCEEDED_SOURCES: readonly PaymentStatus[] = ['initiated', 'pending', 'failed'];

/** Statuses from which the linked order may move to paid. */
export const ORDER_PAID_SOURCES: readonly OrderStatus[] = ['created', 'payment_pending', 'failed'];

/** Statuses from which a failure/expiry event may be applied. */
export const PAYMENT_FAILURE_SOURCES: readonly PaymentStatus[] = ['initiated', 'pending'];
export const ORDER_FAILURE_SOURCES: readonly OrderStatus[] = ['created', 'payment_pending'];

/** Statuses from which refund/reversal may be applied. */
export const PAYMENT_REFUND_SOURCES: readonly PaymentStatus[] = ['succeeded'];
export const ORDER_REFUND_SOURCES: readonly OrderStatus[] = ['paid', 'partially_refunded'];
