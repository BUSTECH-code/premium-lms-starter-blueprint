# Verification Strategy

## Verification layers

### Unit tests
- Domain calculations and state transitions.
- Completion eligibility.
- Entitlement decisions.
- Payment event idempotency logic.
- Device limit and replacement rules.

### Integration tests
- Database transactions and constraints.
- Payment verification/webhook processing.
- Authorization for course and media access.
- Google Drive/provider adapter behaviour using controlled test doubles.
- Download/licence renewal and revocation flows.

### End-to-end tests
- Register/login and account recovery.
- Course discovery and purchase.
- Payment success, pending and failure.
- Course access after verified purchase.
- Lesson progress and completion.
- Certificate issuance.
- Device registration/replacement.
- Offline download and playback on supported real devices.
- Course withdrawal and notifications.

### Security tests
- Cross-user access attempts.
- Role/permission boundary tests.
- Forged or duplicate payment events.
- Direct media URL/file-ID access attempts.
- Expired/revoked entitlement and licence attempts.
- Rate limits and secret leakage checks.

### Visual and usability verification
- Browser screenshots at agreed viewports.
- Compare actual rendering against approved reference images.
- Test keyboard navigation and focus.
- Test loading, empty, error and success states.
- Test on realistic mobile viewport and network conditions.

## Evidence policy

A check is only reported as passed if it was run and its result observed. Distinguish:
- Not run.
- Blocked.
- Failed.
- Passed.

Do not substitute a successful build for functional verification. Do not substitute functional tests for visual inspection.

## Phase 3 evidence status (2026-11-05)

- Unit, integration and DOM/component tests for lesson state transitions, sequential unlock,
  explicit completion, quiz grading/gradebook, offline event replay, media authorization and
  dashboard progress views: **Passed** (`npm test`: 26 files / 242 tests).
- Migration apply, checksum recording and tamper detection: **Passed** (including
  `0004_learning_engine`).
- `npm run typecheck`, `npm run build`, `npm run migrate` and idempotent `npm run seed:fixtures`:
  **Passed**.
- Browser screenshots at agreed viewports, keyboard/focus inspection and reference-image
  comparison: **Not run** in this environment. DOM component tests cover loading, error, locked,
  progress and completion states, but visual acceptance remains a follow-up.
- Real-device offline playback/licence renewal and certificate issuance: **Not run / out of scope**.
  Offline reconnection behaviour is verified through client queue and API integration tests;
  certificates are excluded by approved Q4.

See `docs/implementation/phase-3-learning-and-progress.md` for the full completion report and
still-open decisions.

## Phase 4 evidence status (2026-11-05)

- `npm run migrate`: **Passed** — `0005_phase4_content_protection` applied; `0001_init`,
  `0002_rbac_seed`, `0003_catalog_checkout` and `0004_learning_engine` already applied. Applied
  checksum/column/tamper tests for 0005 are included in the suite.
- `npm test`: **Passed** — `29 files / 258 tests`. Includes signed media delivery, hotlink and
  signature denial, media rate limits, audit content, progress checksum/quarantine, migration
  checks, full learning journey, DOM component tests for the five requested views, shared UI/state
  primitives and CSS/token/responsive-band tests.
- `npm run typecheck`: **Passed** — `tsc -b && npm run typecheck -w @lms/web`.
- `npm run build`: **Passed** — Vite v8.3.6, 45 modules, CSS `37.92 kB` (gzip `6.83 kB`), JS
  `329.51 kB` (gzip `100.69 kB`).
- `npm run seed:fixtures`: **Passed** — idempotent `0/0/0` new fixtures.
- Automated browser screenshots, rendered viewport comparison, keyboard/focus browser inspection
  and visual acceptance report: **Not run**. Approved Phase 4 sign-off uses DOM component tests,
  full typechecking and production build verification; no visual comparison is claimed.
- Real-device offline playback/licence renewal, native device registration and certificate
  issuance: **Not run / out of scope / deferred**.

See `docs/implementation/phase-4-content-protection-and-design.md` for the full completion report
and still-open decisions.

## Task 1 Paystack evidence status (2026-11-06)

- `npm test -- --reporter=dot`: **Passed** — `32 files / 278 tests`. New Paystack coverage includes
  adapter signature/amount primitives, server-priced `POST /api/checkout/initialize`, strict
  `x-paystack-signature` denial/acceptance on exact raw bytes, webhook-driven enrolment and
  idempotent replay, owner-scoped `GET /api/checkout/verify/:reference`, non-success callback
  verification, env key/callback validation, browser config, Paystack Inline popup, validated
  redirect fallback, callback granted/held states and the existing full Phase 1–4 suites.
- `npm run typecheck`: **Passed** — `tsc -b && npm run typecheck -w @lms/web`.
- Live Paystack HTTP calls: **Stubbed in tests**. Clearly fake `sk_test_`/`pk_test_` keys are used;
  no real credential or live gateway request was made.
- `npm run build`, migration, seed, commit, push and PR: **Not requested / not run** for Task 1.
- Automated browser screenshots and real-device payment testing: **Not run**. Frontend sign-off uses
  jsdom component tests; no visual comparison or live-money claim is made.

See `docs/implementation/task-1-paystack-integration.md` for the Task 1 completion report.


## Task 2 final polish evidence status (2026-11-07)

- `npm test -- --reporter=dot`: **Passed** — `34 files / 335 tests`, duration `269.12s`. New
  regression suites cover user-facing product language, API response/seeded content language,
  commercial checkout routes, WCAG AA token contrast, typography/spacing token use, five
  responsive bands, landmarks, skip-link focus order, accessible names and keyboard reachability.
- `npm run typecheck`: **Passed** — `tsc -b && npm run typecheck -w @lms/web`; zero type errors.
- `npm run build`: **Passed** — Vite v8.3.6, 47 modules, CSS `38.03 kB` (gzip `6.79 kB`), JS
  `337.27 kB` (gzip `102.51 kB`), built in `463ms`.
- Warning scan of the test, typecheck and build logs: **none**.
- `git diff --check`: **Passed**.
- Automated browser screenshots, rendered viewport comparison, real-device checks, live-money
  Paystack testing, performance/accessibility browser inspection and production credentials:
  **Not run / unresolved**. Historical Open requirements remain Open; no visual acceptance or
  live-money claim is made.
- Commercial deployment sign-off is therefore limited to the automated gates: all requested
  automated checks are 100% green. See `docs/implementation/task-2-final-polish-and-production-signoff.md`.
