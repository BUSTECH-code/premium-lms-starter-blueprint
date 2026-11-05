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
