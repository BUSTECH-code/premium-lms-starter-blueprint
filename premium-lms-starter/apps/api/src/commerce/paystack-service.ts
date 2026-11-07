import {
  getOwnedOrder,
  getOwnedOrderByPaymentRef,
  insertAuditEvent,
  setOrderStatus,
  setPaymentStatus,
  type PaymentStatus,
} from '@lms/db';
import { errors } from '../lib/errors.js';
import type { PaymentProvider } from '../payments/provider.js';
import {
  majorAmountToMinorUnits,
  parsePaystackWebhook,
  paystackTransactionToEvent,
  type PaystackClient,
} from '../payments/paystack.js';
import {
  createCheckout,
  toCheckoutView,
  type CheckoutDeps,
  type CheckoutView,
} from './checkout-service.js';
import {
  processVerifiedPaymentEvent,
  type WebhookResult,
} from './webhook-service.js';

export interface PaystackServiceDeps extends CheckoutDeps {
  client: PaystackClient;
}

export interface PaystackInitializationResult {
  reference: string;
  authorizationUrl: string;
  accessCode: string;
  publicKey: string;
  email: string;
  reused: boolean;
  checkout: CheckoutView;
}

/**
 * Create/resume a server-priced order, then ask Paystack to initialise that
 * exact reference. The browser never supplies a price, email, callback URL or
 * redirect target.
 */
export async function initializePaystackCheckout(
  deps: PaystackServiceDeps,
  userId: string,
  email: string,
  courseSlug: string,
): Promise<PaystackInitializationResult> {
  const { db, env, provider } = deps;
  const { view, reused } = await createCheckout(deps, userId, courseSlug);
  const payment = view.payment;
  if (
    !payment ||
    payment.provider !== provider.name ||
    !payment.providerReference ||
    (payment.status !== 'initiated' &&
      payment.status !== 'pending' &&
      payment.status !== 'failed')
  ) {
    throw errors.conflict('checkout_not_open', 'This checkout is no longer payable.');
  }
  const reference = payment.providerReference;
  const amountMinorUnits = majorAmountToMinorUnits(payment.amount);

  const initialization = await deps.client.initializeTransaction({
    email,
    amountMinorUnits,
    currency: payment.currency,
    reference,
    callbackUrl: env.paystack.callbackUrl,
    metadata: {
      orderId: view.order.id,
      paymentId: payment.id,
      userId,
      courseSlug: view.course.slug,
    },
  });

  if (payment.status !== 'pending') {
    await setPaymentStatus(db, {
      paymentId: payment.id,
      from: payment.status as PaymentStatus,
      to: 'pending',
    });
  }
  if (view.order.status === 'created' || view.order.status === 'failed') {
    await setOrderStatus(db, {
      orderId: view.order.id,
      from: view.order.status,
      to: 'payment_pending',
    });
  }
  await insertAuditEvent(db, {
    actorUserId: userId,
    action: 'checkout.paystack_initialized',
    targetType: 'order',
    targetId: view.order.id,
    metadata: {
      paymentId: payment.id,
      reference,
      courseSlug: view.course.slug,
      provider: 'paystack',
    },
  });

  const refreshed = await getOwnedOrder(db, view.order.id, userId);
  if (!refreshed) throw errors.internal('Order disappeared during checkout initialisation.');

  return {
    reference,
    authorizationUrl: initialization.authorizationUrl,
    accessCode: initialization.accessCode,
    publicKey: env.paystack.publicKey,
    email,
    reused,
    checkout: toCheckoutView(refreshed),
  };
}

/**
 * Strict Paystack webhook: verify the exact raw-body HMAC before parsing,
 * then route a successful charge through the same idempotent receipt and
 * enrolment transaction used by every other payment event.
 */
export async function processPaystackWebhook(
  deps: PaystackServiceDeps,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<WebhookResult> {
  if (!deps.provider.verify(rawBody, signature)) {
    throw errors.unauthorized('invalid_signature', 'Webhook signature is invalid.');
  }
  const parsed = parsePaystackWebhook(rawBody);
  if (parsed.kind === 'ignored') {
    return { status: 'ignored', reason: parsed.reason };
  }
  return processVerifiedPaymentEvent(
    { db: deps.db, provider: deps.provider },
    parsed.event,
    parsed.payload,
  );
}

export interface PaystackVerificationResult extends Omit<WebhookResult, 'status'> {
  status: WebhookResult['status'] | 'pending';
  reference: string;
  providerStatus: string;
  accessGranted: boolean;
  granted: boolean;
  enrollmentCreated: boolean;
  checkout: CheckoutView;
}

/**
 * Frontend callback fallback. The reference is owner-scoped before any
 * outbound verification; a successful provider transaction is normalised to
 * the same internal event id as the webhook, so whichever arrives first wins.
 */
export async function verifyPaystackCheckout(
  deps: PaystackServiceDeps,
  userId: string,
  reference: string,
): Promise<PaystackVerificationResult> {
  const { db, provider } = deps;
  const view = await getOwnedOrderByPaymentRef(db, provider.name, reference, userId);
  if (!view) {
    throw errors.notFound('checkout_not_found', 'Checkout session not found.');
  }
  const payment = view.payments.find(
    (row) => row.provider === provider.name && row.provider_reference === reference,
  );
  if (!payment) {
    throw errors.notFound('checkout_not_found', 'Payment attempt not found.');
  }

  if (view.order.status === 'paid') {
    return {
      status: 'processed',
      reason: 'already_paid',
      reference,
      providerStatus: 'success',
      paymentStatus: payment.status,
      orderStatus: view.order.status,
      accessGranted: true,
      granted: false,
      enrollmentCreated: false,
      checkout: toCheckoutView(view),
    };
  }

  const transaction = await deps.client.verifyTransaction(reference);
  if (transaction.status !== 'success') {
    return {
      status: 'pending',
      reason: `provider_status:${transaction.status.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64)}`,
      reference,
      providerStatus: transaction.status,
      paymentStatus: payment.status,
      orderStatus: view.order.status,
      accessGranted: false,
      granted: false,
      enrollmentCreated: false,
      checkout: toCheckoutView(view),
    };
  }

  const event = paystackTransactionToEvent(transaction, 'charge.success');
  const result = await processVerifiedPaymentEvent(
    { db, provider },
    event,
    { source: 'paystack.verify', transaction },
  );
  const refreshed = await getOwnedOrder(db, view.order.id, userId);
  if (!refreshed) throw errors.internal('Order disappeared during checkout verification.');

  return {
    ...result,
    reference,
    providerStatus: transaction.status,
    accessGranted: refreshed.order.status === 'paid',
    granted: result.granted ?? false,
    enrollmentCreated: result.enrollmentCreated ?? false,
    checkout: toCheckoutView(refreshed),
  };
}
