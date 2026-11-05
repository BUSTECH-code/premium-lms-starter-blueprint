# Phase 2 — Catalogue, purchase & enrolment build log

Implements `docs/product/requirements.md` (catalogue/discovery, one-time
purchase with server-verified payment, entitlement-based access) and
`docs/workflows/purchase-and-enrolment.md` + `docs/workflows/course-withdrawal.md`
as far as the approved requirements go. Open decisions stay open — nothing
below invents an answer to O-01/O-05/O-20/O-21.

## What was built

**Database (`packages/db`)**
- `migrations/0003_catalog_checkout.sql` — `users.bio`, course price
  (`NUMERIC(12,2)` + currency, format-checked, backfilled `NGN` placeholder),
  `categories`/`course_categories` taxonomy tables, `courses.tags TEXT[]` +
  GIN index, `orders.expires_at` + partial open-checkout index.
- `domain/order-state.ts` — order & payment state-transition tables derived
  from the architecture state machines, including late-success precedence
  (`failed → paid`) and terminal money-out states.
- `repos/catalog.ts` — published-only listing with search (title/summary/
  description/instructor/tag), category & tag filters, pagination, curriculum,
  category counts.
- `repos/commerce.ts` — order creation (price from course row, TTL),
  guarded status updates, abandoned-checkout sweep, idempotent
  `payment_events` receipts, **single-transaction** success handler
  (payment → order → entitlement → enrolment + audits), failure & refund
  handlers, learner library reads.

**API (`apps/api`)**
- `payments/provider.ts` — provider seam; `SimulatedPaymentProvider`
  (HMAC-SHA256 over raw body, `sha256=<hex>`, constant-time compare).
  Real gateway remains open (O-05); production-like envs need
  `ALLOW_SIMULATED_PAYMENTS=true` + strong `SIMULATED_WEBHOOK_SECRET`.
- `commerce/webhook-service.ts` — verify → parse → idempotent receipt →
  re-validate amount/currency/reference → dispatch in one transaction →
  record outcome (`processed | duplicate | ignored | quarantined`).
  Quarantine (no grant): unknown reference, money mismatch, withdrawn
  during checkout, revoked-entitlement conflict, unreconcilable states.
  Refunds/reversals transition money state only and audit
  `entitlementReview: required` — **no automatic revocation** (O-20 open).
- `commerce/checkout-service.ts` — start/resume checkout (one open order per
  user+course), owner cancel, simulated completion that builds a **signed**
  provider event and runs the real webhook pipeline (no direct grant path).
- Routes: `GET /api/courses`, `GET /api/categories`, `GET /api/courses/:slug`
  (public if published; other statuses only with active entitlement —
  withdrawn history preserved per O-01-unresolved), `POST/GET /api/orders`,
  `GET /api/orders/:id`, `POST /api/orders/:id/cancel`,
  `GET/POST /api/simulated/checkout/:reference[/complete]`,
  `POST /api/webhooks/payments`, `GET /api/me/enrollments`, `GET /api/me/orders`.
- Config: `STORE_CURRENCY`, `PAYMENT_PROVIDER`, `ALLOW_SIMULATED_PAYMENTS`,
  `SIMULATED_WEBHOOK_SECRET`, `CHECKOUT_TTL_MINUTES`,
  `RATE_LIMIT_CHECKOUT_*` (per-user limiter on order/checkout actions).

**Web (`apps/web`)**
- `CatalogPage` (`/courses`) — search, category chips, tag filter, editorial
  **row** layout (not a card wall), server-driven pagination.
- `CourseDetailPage` (`/courses/:slug`) — breadcrumb, curriculum accordion,
  instructor bio (never invented), sticky purchase card; sign-in/purchase/
  dashboard CTAs by state; withdrawn courses never show a buy button.
- `SimulatedCheckoutPage` (`/checkout/simulated/:reference`) — honest
  simulated-gateway banner, order summary, success/failure/review/expired
  outcomes, retry after failure.
- `AccountPage` — "Your courses" library from `/api/me/enrollments`.
- `lib/format.ts` — price/duration/date rendering (unit-tested).

**Tooling**
- `npm run seed:fixtures` — idempotent development fixtures (8 courses:
  6 published, 1 draft, 1 withdrawn; 4 categories; fixture instructor).
  Clearly marked: `fixture` tag on every course, `[Development fixture]`
  summary marker, `example.com` email, `fixtures.seeded` audit event.
  Refuses to run in staging/production.

## Decisions made (engineering defaults — product decisions stay open)

| Topic | Decision | Status |
|---|---|---|
| Payment provider | Simulated only, behind the `PaymentProvider` seam | O-05 open |
| Currency | `NGN` placeholder, format-checked, server-priced | O-05/O-21 open |
| Refund/chargeback access | Money state + `entitlementReview` audit; **no auto-revoke** | O-20 open |
| Purchaser access after withdrawal | Hidden from non-entitled buyers; entitled learners keep metadata/history; entitlements never revoked by withdrawal | O-01 open (not decided here) |
| Open checkout reuse | One unexpired open order per user+course (returned, not duplicated) | implementation detail |
| Late provider success | `failed → paid` allowed; success after expiry quarantines | workflow precedence |
| Duplicate purchase | 409 `already_owned` up front; grant path idempotent | workflow rule |

## Verification evidence (actually run)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | **206/206 passed, 20 files** (db 72 · api 106 · web 28) |
| `npm run build` | exit 0 (web bundle) |
| `npm run migrate` | `0001_init`, `0002_rbac_seed`, `0003_catalog_checkout` applied |
| `npm run seed:fixtures` | 8 courses, 4 categories |
| Live smokes (API :4000 + web :5173) | **15/15 pass** |

Test files: db `migrations|repositories|schema-constraints|catalog|commerce`;
api `env|passwords|tokens|rate-limit|auth-flows|rbac|security|catalog|checkout-journey|webhooks`;
web `permissions|format|catalog|course-detail|checkout` (jsdom component tests).

Live smoke list: catalogue lists6 fixtures with no invented fields · categories ·
detail price/curriculum · draft/withdrawn/unknown →404 · register · order at
server price · session payable · simulated payment → `processed/granted/paid` ·
enrolment in library · duplicate →409 · unsigned webhook →401 · client price
ignored · web `/courses` SPA · index shell.

Journey coverage (supertest E2E): browse → detail → checkout → simulated
payment → webhook verification → instant library access → duplicate blocked →
idempotent re-pay; failure then late success; owner cancel; TTL sweep;
withdrawal mid-checkout quarantined with full rollback; ownership checks;
auth required; checkout rate limit (429). Webhook coverage: signature
rejects, malformed event, exact-once grant (duplicate + already-applied),
amount/currency/unknown-ref quarantine, out-of-order failure ignored,
refund without revocation, reversal-after-failure ignored.

During this audit one flaky test was found and fixed: the webhook test
signed a *separately constructed* copy of the event, so a millisecond
boundary in `created` legitimately broke the HMAC. Tests now serialise and
sign once; 5/5 consecutive runs green.

## Known limitations / follow-ups

- **No browser E2E or visual-acceptance claims** — no browser tooling exists
  in this environment; HTTP journey tests + jsdom component tests are the
  substitute (per AGENTS.md evidence rules).
- Real payment gateway, currencies, receipts/taxes: awaiting O-05/O-21.
- Refund/chargeback entitlement policy: awaiting O-20 (audit flags only).
- Withdrawal scheduling,30-day notices and learner notifications
  (course-withdrawal workflow steps1–7) belong to the admin/operations
  phase; Phase 2 implements the purchase-facing rules (stop sales,
  preserve history).
- Email/notification delivery (workflow step10) not built — library display
  is the verified access surface.
- `partially_refunded` state exists in the state machine but no partial
  refund amounts are modelled yet (needs O-20 detail).
- Catalogue authoring/admin UI not in this phase (fixtures + SQL only).
