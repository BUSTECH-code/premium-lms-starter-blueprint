import { z } from 'zod';

/**
 * Webhook event contract shared by the simulated provider (in-app checkout)
 * and any future gateway adapter. The envelope mirrors common gateway
 * practices: a unique event id (idempotency), an event type, and a data
 * payload carrying the payment reference plus the money facts the server
 * re-validates against its own records before granting anything.
 */
export const paymentEventSchema = z.object({
  id: z.string().trim().min(1).max(128),
  type: z.enum(['payment.succeeded', 'payment.failed', 'payment.refunded', 'payment.reversed']),
  created: z.union([z.string().min(1).max(64), z.number()]),
  data: z.object({
    payment: z.object({
      reference: z.string().trim().min(1).max(200),
      // Providers send minor-unit integers or 1–2 decimal strings; we normalise
      // to a canonical 2-decimal string and compare exactly against NUMERIC(12,2).
      amount: z.union([z.string().trim().regex(/^\d+(\.\d{1,2})?$/), z.number().nonnegative()]),
      currency: z.string().trim().regex(/^[A-Z]{3}$/),
    }),
  }),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type PaymentEventType = PaymentEvent['type'];

/** Normalise amount to the canonical 2-decimal string used by NUMERIC(12,2). */
export function normaliseAmount(amount: string | number): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid amount.');
  }
  return value.toFixed(2);
}
