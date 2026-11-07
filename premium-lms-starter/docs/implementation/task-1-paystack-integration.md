# Task 1 — Paystack Integration & Transaction Hardening

**Date:** 2026-11-06  
**Branch:** `arena/6233c339-premium-lms-starter-blueprint`  
**Status:** Implemented and verified. Changes remain uncommitted; no commit, push or PR was requested for this task.

## 1. Scope delivered

### Backend (`apps/api`)

- Extended `parseEnv` with `PAYMENT_PROVIDER=simulated|paystack`, server-only `PAYSTACK_SECRET_KEY`,
  public `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_API_BASE_URL` and `PAYSTACK_CALLBACK_URL`.
  - Production-like environments require matching `sk_live_`/`pk_live_` keys, the official
    `https://api.paystack.co` origin and an allowlisted HTTPS callback URL.
  - Test/live mode mismatches, placeholders, non-Paystack origins, callback query/hash strings and
    unexpected callback paths are rejected at boot.
  - `STORE_CURRENCY=NGN` remains a format-checked development placeholder; currency, payment-method
    and reconciliation decisions remain Open.
- Added `apps/api/src/payments/paystack.ts`:
  - `PaystackPaymentProvider`: constant-time SHA-512 HMAC verification of `x-paystack-signature`
    over exact raw bytes; malformed/prefixed/short signatures fail closed.
  - `PaystackClient`: mockable `fetch` adapter for `POST /transaction/initialize` and
    `GET /transaction/verify/:reference`, strict Zod response validation, Paystack-owned HTTPS
    authorization-URL validation, reference matching and exact minor-unit conversions.
  - Paystack webhook parser: only `charge.success` with `status: success` can enter the grant
    pipeline; other events are acknowledged as ignored.
- Added `apps/api/src/commerce/paystack-service.ts` and wired three routes in
  `apps/api/src/commerce/routes.ts`:
  - `POST /api/checkout/initialize` — authenticated, rate-limited, server-priced order/reuse,
    Paystack initialization with server-owned email, amount, currency, reference, metadata and
    callback URL; marks the payment/order pending and audits initialization. Returns only public
    browser configuration, never the secret key.
  - `POST /api/checkout/webhook` — unauthenticated but HMAC-verified using `req.rawBody` captured by
    `express.json.verify`. Signature verification precedes JSON parsing. Successful charges are
    normalized into the existing internal payment-event contract and processed through the same
    idempotent `payment_events` receipt, money re-validation and transactional
    entitlement/enrolment grant used by simulated payments.
  - `GET /api/checkout/verify/:reference` — authenticated, owner-scoped, rate-limited callback
    fallback. Calls Paystack with the server secret, then uses the same normalized event id and
    fulfilment pipeline as the webhook; pending, quarantined, duplicate and already-paid states do
    not double-grant access.
- Refactored `processPaymentWebhook` to expose `processVerifiedPaymentEvent`, so Paystack webhooks
  and callback verification share one receipt/dispatch path while simulated webhooks keep their
  original raw-body signature check.
- Hardened provider boundaries:
  - `createCheckout` now keys order creation/open-order reuse from the active `PaymentProvider.name`.
  - `originCheck` exempts HMAC-authenticated provider webhook paths from browser CSRF Origin checks.
  - Simulated checkout/webhook endpoints remain available only when configured; Paystack endpoints
    are mounted only when `PAYMENT_PROVIDER=paystack`.

### Frontend (`apps/web`)

- Added `apps/web/src/config/paystack.ts` for browser-safe `VITE_PAYSTACK_PUBLIC_KEY` handling:
  public-key format validation, Paystack-owned HTTPS redirect validation, Paystack Inline loader and
  `window.open(..., '_self')` redirect fallback. `PAYSTACK_SECRET_KEY` is never read by Vite.
- Updated `apps/web/vite.config.ts` and `vitest.config.ts` to load the workspace-root `.env.<mode>`
  files so the web app and tests see the same `VITE_*` configuration.
- Added `apps/web/src/pages/PaystackCheckoutPage.tsx`:
  - dynamically calls `POST /api/checkout/initialize` with only the course slug;
  - opens Paystack Inline with the public key, email and access code, or falls back to a validated
    Paystack redirect;
  - handles `/checkout/paystack/callback?reference=...` (also accepts `trxref`), calls the
    owner-scoped verify endpoint and renders granted, pending, held-for-review, loading and error
    states with the shared editorial components.
- Updated `CourseDetailPage` to route purchases to the Paystack checkout view when the public browser
  key is configured, while preserving the simulated-checkout fallback. Added both Paystack routes to
  `App.tsx`.
- Updated `.env.example`, `.env.development` and `.env.test`. Committed values contain **no real
  credentials**: development/example secret/public keys are blank, and `.env.test` uses an obviously
  fake `pk_test_` browser key.

## 2. Tests added

- `apps/api/tests/paystack-checkout.test.ts` — 8 tests covering adapter signature/amount primitives,
  unsupported event ignoring, Paystack initialization headers/body/public response, missing/forged/
  raw-body-mutated signature denial, valid webhook enrolment and duplicate replay, owner-scoped
  callback verification, stranger denial and non-success callback no-grant.
- `apps/api/tests/env.test.ts` — 4 new Paystack config tests for enabled provider, key requirements/
  mode matching, production-like live keys/API origin and callback origin/path validation.
- `apps/web/src/config/paystack.test.ts` — 4 tests for public-key config, `.env.test` loading,
  Paystack-owned redirect validation and safe redirect.
- `apps/web/src/pages/paystack-checkout.test.tsx` — 4 jsdom component tests for dynamic
  initialization/Paystack Inline popup, validated redirect fallback, callback access-granted state
  and quarantined callback state.

All outbound Paystack HTTP is stubbed in tests. No real credential or live gateway request was used.

## 3. Verification actually run

| Command | Result |
|---|---|
| `npm install --no-audit --no-fund` | Passed — `added 242 packages in 7s` (restored ignored `node_modules` in this sandbox) |
| `npx vitest run apps/web/src/config/paystack.test.ts` | Passed — `1 file / 4 tests` |
| `npx vitest run apps/api/tests/paystack-checkout.test.ts` | Passed — `1 file / 8 tests` |
| `npx vitest run apps/api/tests/env.test.ts` | Passed — `1 file / 27 tests` |
| `npm run typecheck && npx vitest run apps/web/src/pages/paystack-checkout.test.tsx` | Passed — typecheck clean; `1 file / 4 tests` |
| `npm test -- --reporter=dot` | **Passed — `32 files / 278 tests`**, duration `347.60s` |
| `npm run typecheck` | **Passed** — `tsc -b && npm run typecheck -w @lms/web` |

The final `npm test` and `npm run typecheck` were run in parallel after all source/config/test
changes. Only documentation and this report were edited afterwards.

## 4. Documentation and decision handling

Updated `README.md`, `docs/product/open-requirements.md`, `docs/product/requirements.md`,
`docs/workflows/purchase-and-enrolment.md`, `docs/architecture/system-architecture.md`,
`docs/security/authentication-and-authorization.md`,
`docs/implementation/verification-strategy.md`, `docs/implementation/development-phases.md` and
historical Phase 2/3/4 notes. The O-05 **payment provider choice** is now recorded as Paystack by
explicit owner request. Currency, payment methods, tax/receipts and reconciliation/refund procedures
remain Open; no additional decision was invented. Historical Phase 3/4 evidence (`29 files / 258
tests`, build, seed and screenshot absence) is preserved as historical.

## 5. Not run / not requested

- `npm run build`, `npm run migrate`, `npm run seed:fixtures`, commit, push and PR: not requested for Task 1.
- Automated browser screenshots, visual comparison and real-device/live-money payment testing: **Not run**.
- No real Paystack key is committed or exposed to the browser; `PAYSTACK_SECRET_KEY` remains server-only.
