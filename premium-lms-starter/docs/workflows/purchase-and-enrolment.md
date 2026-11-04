# Workflow: Course Purchase and Access

## Goal

Grant course access only after the payment provider confirms a successful payment.

## Happy path

1. Learner selects a published course.
2. Backend confirms course is purchasable and retrieves current price.
3. Backend creates an order and payment attempt.
4. Learner completes payment with the provider.
5. Provider sends a signed/verified webhook or backend independently verifies payment.
6. Backend validates provider reference, amount, currency, order association and status.
7. Backend processes the event idempotently.
8. In a transaction, mark payment successful and create/activate the course entitlement.
9. Create or activate enrolment if the product model requires it.
10. Notify learner and display access in the library.

## Failure and edge cases

- Payment pending: no entitlement.
- Payment failed/cancelled: no entitlement.
- Browser returns success but provider verification fails: no entitlement.
- Duplicate webhook: no duplicate entitlement or side effect.
- Webhook arrives before browser redirect: process safely.
- Webhook arrives late: process after verification.
- Amount/currency mismatch: quarantine for reconciliation; do not grant access.
- Payment succeeds but DB transaction fails: retry safely and reconcile.
- Duplicate payment: identify and route to approved refund/reconciliation policy.
- Chargeback or reversal: apply explicit entitlement review/revocation policy and audit it.
- Course withdrawn during checkout: re-check sale eligibility before accepting/granting purchase.

## Security rules

- Never trust client-supplied price, payment status or course entitlement.
- Verify webhook signatures according to provider documentation.
- Keep provider secrets server-side.
- Store event IDs and provider references for idempotency.
- Log decisions without exposing credentials or payment secrets.

## Open decisions

- Payment provider and supported methods.
- Currency and tax handling.
- Receipt/invoice requirements.
- Exact refund, duplicate charge and chargeback procedures.
