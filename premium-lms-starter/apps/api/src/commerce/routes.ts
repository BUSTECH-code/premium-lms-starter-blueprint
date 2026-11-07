import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getOwnedOrder,
  getOwnedOrderByPaymentRef,
  listEnrollmentsForUser,
  listOrdersForUser,
  type DbClient,
  type PaymentRow,
} from '@lms/db';
import { authenticate } from '../auth/middleware.js';
import { SlidingWindowRateLimiter, rateLimit } from '../auth/rate-limit.js';
import type { Env } from '../config/env.js';
import { AppError, errors } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import {
  getValidatedParams,
  getValidatedQuery,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate.js';
import { createPaymentProvider, type PaymentProvider } from '../payments/provider.js';
import {
  PAYSTACK_SIGNATURE_HEADER,
  PaystackClient,
} from '../payments/paystack.js';
import {
  cancelCheckout,
  completeSimulatedCheckout,
  createCheckout,
  toCheckoutView,
  type CheckoutDeps,
} from './checkout-service.js';
import {
  initializePaystackCheckout,
  processPaystackWebhook,
  verifyPaystackCheckout,
  type PaystackServiceDeps,
} from './paystack-service.js';
import { processPaymentWebhook } from './webhook-service.js';

const createOrderBodySchema = z.object({
  courseSlug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Invalid course slug.')
    .min(2)
    .max(80),
});

const orderIdParamsSchema = z.object({
  id: z.uuid('A valid order id is required.'),
});

const referenceParamsSchema = z.object({
  reference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,200}$/, 'Invalid payment reference.'),
});

const completeBodySchema = z.object({
  outcome: z.enum(['success', 'failure']),
});

const listQueryDefaults = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

interface CommerceRouterDeps {
  env: Env;
  db: DbClient;
  logger: Logger;
  checkoutLimiter: SlidingWindowRateLimiter;
}

function serializePayment(payment: PaymentRow) {
  return {
    id: payment.id,
    status: payment.status,
    provider: payment.provider,
    providerReference: payment.provider_reference,
    amount: payment.amount,
    currency: payment.currency,
    processedAt: payment.processed_at,
  };
}

export function createCommerceRouter(deps: CommerceRouterDeps): Router {
  const { env, db, logger, checkoutLimiter } = deps;
  const router = Router();

  const provider: PaymentProvider = createPaymentProvider({
    provider: env.commerce.provider,
    webhookSecret: env.commerce.webhookSecret,
    paystackSecretKey: env.paystack.secretKey,
  });
  const checkout: CheckoutDeps = { env, db, provider };
  const paystack: PaystackServiceDeps | null = env.paystack.enabled
    ? {
        ...checkout,
        client: new PaystackClient({
          secretKey: env.paystack.secretKey,
          apiBaseUrl: env.paystack.apiBaseUrl,
        }),
      }
    : null;

  const checkoutLimit = rateLimit({
    limiter: checkoutLimiter,
    keyOf: (req) => `checkout:${req.auth?.user.id ?? 'anon'}`,
    message: 'Too many checkout attempts. Please try again shortly.',
  });

  // --------------------------------------------------------------------------
  // POST /api/orders — start (or resume) a course checkout
  // --------------------------------------------------------------------------
  router.post(
    '/orders',
    authenticate(env, db),
    checkoutLimit,
    validateBody(createOrderBodySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const body = req.body as z.infer<typeof createOrderBodySchema>;
        const { view, reused } = await createCheckout(checkout, auth.user.id, body.courseSlug);
        res.status(reused ? 200 : 201).json({
          order: view.order,
          course: view.course,
          payment: view.payment,
          reused,
          checkoutUrl:
            view.payment && env.commerce.simulationEnabled && provider.name === 'simulated'
              ? `/checkout/preview/${view.payment.providerReference}`
              : null,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/orders — the signed-in learner's order history
  // --------------------------------------------------------------------------
  router.get(
    '/orders',
    authenticate(env, db),
    validateQuery(listQueryDefaults),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const query = getValidatedQuery<z.infer<typeof listQueryDefaults>>(req);
        const { items, total } = await listOrdersForUser(db, auth.user.id, {
          limit: query.limit,
          offset: query.offset,
        });
        res.json({
          items: items.map((order) => ({
            id: order.id,
            status: order.status,
            currency: order.currency,
            totalAmount: order.total_amount,
            expiresAt: order.expires_at,
            createdAt: order.created_at,
            course: { slug: order.course_slug, title: order.course_title },
            paymentStatus: order.payment_status,
            paymentReference: order.payment_reference,
          })),
          total,
          limit: query.limit,
          offset: query.offset,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/orders/:id — one order (owner only; admins use the audit log)
  // --------------------------------------------------------------------------
  router.get(
    '/orders/:id',
    authenticate(env, db),
    validateParams(orderIdParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { id } = getValidatedParams<z.infer<typeof orderIdParamsSchema>>(req);
        const view = await getOwnedOrder(db, id, auth.user.id);
        if (!view) throw errors.notFound('order_not_found', 'Order not found.');
        res.json({
          order: view.order,
          course: { slug: view.course_slug, title: view.course_title },
          payments: view.payments.map(serializePayment),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/orders/:id/cancel — owner cancels an open checkout
  // --------------------------------------------------------------------------
  router.post(
    '/orders/:id/cancel',
    authenticate(env, db),
    checkoutLimit,
    validateParams(orderIdParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { id } = getValidatedParams<z.infer<typeof orderIdParamsSchema>>(req);
        const view = await cancelCheckout(checkout, auth.user.id, id);
        res.json({ order: view.order, course: view.course, payment: view.payment });
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // Live Paystack checkout (only enabled when PAYMENT_PROVIDER=paystack)
  // --------------------------------------------------------------------------
  router.post(
    '/checkout/initialize',
    authenticate(env, db),
    checkoutLimit,
    validateBody(createOrderBodySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!paystack) {
          throw errors.notFound('not_found', 'Paystack checkout is not enabled.');
        }
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const body = req.body as z.infer<typeof createOrderBodySchema>;
        const result = await initializePaystackCheckout(
          paystack,
          auth.user.id,
          auth.user.email,
          body.courseSlug,
        );
        logger.info(
          { reference: result.reference, reused: result.reused },
          'paystack checkout initialized',
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // Provider callbacks are unauthenticated but HMAC-verified on the exact raw
  // body. They are asynchronous relative to the browser checkout and use the
  // same idempotent receipt + enrolment transaction as the verify fallback.
  router.post(
    '/checkout/webhook',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!paystack) {
          throw errors.notFound('not_found', 'Paystack webhook is not enabled.');
        }
        const rawBody: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
        if (!rawBody) {
          throw new AppError(400, 'invalid_event', 'Raw request body is required.');
        }
        const signatureValue = req.headers[PAYSTACK_SIGNATURE_HEADER];
        const signature = typeof signatureValue === 'string' ? signatureValue : undefined;
        const result = await processPaystackWebhook(paystack, rawBody, signature);
        logger.info(
          { status: result.status, reason: result.reason },
          'paystack webhook processed',
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // Frontend callback fallback: owner-scoped, rate-limited, and verified with
  // the server secret before any fulfilment decision is returned.
  router.get(
    '/checkout/verify/:reference',
    authenticate(env, db),
    checkoutLimit,
    validateParams(referenceParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!paystack) {
          throw errors.notFound('not_found', 'Paystack checkout is not enabled.');
        }
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { reference } = getValidatedParams<z.infer<typeof referenceParamsSchema>>(req);
        const result = await verifyPaystackCheckout(paystack, auth.user.id, reference);
        logger.info(
          { reference, status: result.status, accessGranted: result.accessGranted },
          'paystack checkout verified',
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // Preview checkout (only mounted when simulationEnabled)
  // --------------------------------------------------------------------------
  if (env.commerce.simulationEnabled) {
    // GET /api/checkout/preview/:reference — checkout session for the owner
    router.get(
      '/checkout/preview/:reference',
      authenticate(env, db),
      validateParams(referenceParamsSchema),
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const auth = req.auth;
          if (!auth) throw errors.unauthorized();
          const { reference } = getValidatedParams<z.infer<typeof referenceParamsSchema>>(req);
          const view = await getOwnedOrderByPaymentRef(
            db,
            provider.name,
            reference,
            auth.user.id,
          );
          if (!view) {
            throw errors.notFound('checkout_not_found', 'Checkout session not found.');
          }
          const expired =
            view.order.expires_at !== null && view.order.expires_at.getTime() <= Date.now();
          const latest = view.payments[view.payments.length - 1] ?? null;
          const retryableStatus =
            view.order.status === 'failed' ||
            view.order.status === 'created' ||
            view.order.status === 'payment_pending';
          res.json({
            checkout: toCheckoutView(view),
            expired,
            payable:
              !expired &&
              retryableStatus &&
              latest !== null &&
              (latest.status === 'initiated' ||
                latest.status === 'pending' ||
                latest.status === 'failed'),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    // POST /api/checkout/preview/:reference/complete — confirm preview result.
    // Builds a signed provider event and runs the secure verification workflow.
    router.post(
      '/checkout/preview/:reference/complete',
      authenticate(env, db),
      checkoutLimit,
      validateParams(referenceParamsSchema),
      validateBody(completeBodySchema),
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const auth = req.auth;
          if (!auth) throw errors.unauthorized();
          const { reference } = getValidatedParams<z.infer<typeof referenceParamsSchema>>(req);
          const body = req.body as z.infer<typeof completeBodySchema>;
          const result = await completeSimulatedCheckout(
            checkout,
            auth.user.id,
            reference,
            body.outcome,
          );
          res.json({
            event: { id: result.eventId || null, type: result.eventType },
            status: result.status,
            reason: result.reason,
            granted: result.granted ?? false,
            enrollmentCreated: result.enrollmentCreated ?? false,
            checkout: result.checkout,
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  // --------------------------------------------------------------------------
  // POST /api/webhooks/payments — provider callback (HMAC-signed, no session)
  // --------------------------------------------------------------------------
  router.post(
    '/webhooks/payments',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!env.commerce.simulationEnabled || provider.name !== 'simulated') {
          throw errors.notFound('not_found', 'Webhook endpoint is not enabled.');
        }
        const rawBody: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
        if (!rawBody) {
          throw new AppError(400, 'invalid_event', 'Raw request body is required.');
        }
        const signature = req.headers['x-lms-signature'];
        const result = await processPaymentWebhook(
          { db, provider },
          rawBody,
          typeof signature === 'string' ? signature : undefined,
        );
        logger.info(
          { status: result.status, reason: result.reason },
          'payment webhook processed',
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/me/enrollments — "Your courses" library
  // --------------------------------------------------------------------------
  router.get(
    '/me/enrollments',
    authenticate(env, db),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const items = await listEnrollmentsForUser(db, auth.user.id);
        res.json({
          items: items.map((item) => ({
            enrollmentId: item.enrollment_id,
            course: {
              id: item.course_id,
              slug: item.course_slug,
              title: item.course_title,
              status: item.course_status,
              href: `/courses/${item.course_slug}`,
            },
            status: item.status,
            enrolledAt: item.enrolled_at,
            completedAt: item.completed_at,
            price: { amount: item.price_amount, currency: item.price_currency },
            learning: {
              href: `/learn/${item.course_slug}`,
              progressPercent:
                item.total_lessons > 0
                  ? Math.round((item.completed_lessons / item.total_lessons) * 100)
                  : 0,
              completedLessons: item.completed_lessons,
              totalLessons: item.total_lessons,
              completionStatus: item.completion_status ?? 'in_progress',
              criteriaVersion: item.criteria_version,
              gradebookAverage:
                item.gradebook_average === null ? null : Number(item.gradebook_average),
              gradebookAttempts: item.gradebook_attempts,
            },
          })),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
