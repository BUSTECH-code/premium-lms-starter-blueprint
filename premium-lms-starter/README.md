# Premium LMS Starter Blueprint

A documentation-first blueprint **and implementation foundation** for a premium digital learning platform.

The product and engineering source of truth lives in `docs/` and `AGENTS.md`. The initial product
focuses on recorded video courses and course materials. Live tutoring and other instructor-led
services are future capabilities, not launch requirements.

## Current phase status

| Phase | Scope | Status |
|---|---|---|
| Phase 0 | Discovery and decisions | Open product decisions remain listed in `docs/product/open-requirements.md` |
| **Phase 1** | **Foundation: monorepo, environments, database + migrations, authentication, RBAC, automated checks** | **Implemented (see `docs/implementation/phase-1-foundation.md`)** |
| **Phase 2** | **Catalogue, purchase & enrolment (simulated gateway), learner library** | **Implemented (see `docs/implementation/phase-2-catalog-purchase-enrolment.md`)** |
| **Phase 3** | **Learning & progress engine: responsive course player/dashboard, sequential state machines, quizzes, gradebook, authorized local media, offline-safe progress sync** | **Implemented and verified (see `docs/implementation/phase-3-learning-and-progress.md`)** |
| **Phase 4** | **Web-only content protection, signed media delivery, hardened progressive sync, session watermark and the confirmed editorial design system** | **Implemented and verified (see `docs/implementation/phase-4-content-protection-and-design.md`)** |
| Phase 5+ | Mobile/offline devices, operations, certificates, delivery-provider/CDN choice | Not started. Certificate issuance is deliberately excluded by approved decision Q4; native device registration and offline licensing are explicitly deferred by Phase 4 approval. |

> **Phase-numbering note:** historical `docs/implementation/development-phases.md` describes a
> proposed sequence where content management is Phase 3, commerce is Phase 4 and student learning is
> Phase 5. The active prompts define learning/progress as Phase 3 and content protection/design as
> Phase 4 after the already-implemented foundation and catalogue/checkout work. The active prompts
> take precedence; the historical file is retained for context.

## Repository map

- `AGENTS.md` — mandatory instructions for coding agents.
- `docs/product/` — product vision, scope, requirements, business rules, roles and open decisions.
- `docs/architecture/` — recommended architecture, domain boundaries, data concepts and state models.
- `docs/workflows/` — key business and learner workflows.
- `docs/design/` — premium visual direction, design principles, visual acceptance criteria and references.
- `docs/security/` — security, content protection, devices and offline-learning principles.
- `docs/implementation/` — delivery phases, task rules, verification strategy and the Phase 1/2/3/4 build logs.
- `apps/api/` — backend API (Express 5 + TypeScript): authentication, RBAC, commerce, learning/quiz/progress routes, signed media delivery, anti-hotlink checks and media rate limits.
- `apps/web/` — web application (React 19 + Vite): auth flows, catalogue, checkout, account dashboard, responsive course player, confirmed editorial tokens and shared layout components.
- `packages/db/` — database package: PGlite client, SQL migrations (including `0004_learning_engine.sql` and `0005_phase4_content_protection.sql`), RBAC seed, pure domain state machines and repositories.

## Architecture (Phases 1–4)

Modular monolith with a shared backend API, per `docs/architecture/system-architecture.md`:

- **Database**: PostgreSQL semantics via [PGlite](https://pglite.dev) (real Postgres compiled to
  WASM) — embedded for development and tests, no external service required. The production
  hosting decision (O-34) remains open; the `DbClient` interface in `packages/db` is the seam for
  a managed PostgreSQL driver later. All SQL is standard PostgreSQL.
- **Authentication**: argon2id password hashing; short-lived HS256 JWT access token + opaque,
  rotating refresh token, both in `httpOnly` cookies; sessions stored server-side so revocation is
  immediate; refresh-token reuse detection revokes the session.
- **Authorization**: deny-by-default RBAC — roles (`student`, `instructor`, `admin`) and
  permissions seeded in SQL, enforced by server-side middleware on every protected endpoint and
  mirrored by frontend route guards. The final permission matrix is still an open product
  decision; only the documented Phase 1 baseline is granted (see `docs/implementation/phase-1-foundation.md`).
- **Learning engine**: server-authoritative `not_started → in_progress → completed` lesson state
  machine, sequential all-lessons-required unlocks, exact-once/offline-safe progress events,
  objective quiz auto-grading, frozen completion-rule versions, best-score gradebooks and
  short-lived scoped media grants. Answer keys and private provider references never reach the
  browser. See `docs/implementation/phase-3-learning-and-progress.md`.
- **Phase 4 hardening**: `@lms/shared` canonical batch checksums, `0005_phase4_content_protection.sql`
  session/user-agent-bound grants, HMAC-signed URLs, anti-hotlink/no-store/CORP headers, audit
  events, media rate limits, a visible session watermark, checksum-exact PDF delivery and a
  checksummed/quarantining browser sync queue. Native device registration and offline licensing are
  deferred. See `docs/implementation/phase-4-content-protection-and-design.md`.
- **Confirmed editorial design system**: exact tokens in `apps/web/src/styles/tokens.css`, shared
  `PageIntro`/`CourseCover`/`Stepper`/`Stat`/`StatePanel` primitives, five responsive CSS bands and
  consistent loading/empty/error/success/disabled/validation/confirmation states across the five
  requested views. Browser screenshots were Not run.

## Quick start

Requirements: Node.js >= 22.

```bash
npm install          # install workspace dependencies
npm run dev          # start API (:4000) + web (:5173) with migrations applied on boot
npm test             # run the full unit/integration/DOM test suite (258 tests)
npm run typecheck    # TypeScript project build + web typecheck
npm run build        # production build (backend compile + web bundle)
npm run migrate      # apply pending database migrations explicitly
npm run seed:fixtures # seed development courses, lessons, quiz questions and local media metadata
```

Open <http://localhost:5173>. Register a student account; purchase a seeded course through the
simulated checkout, then open `/learn/:slug` to use the course player. Promote an account to `admin`
in the database (or via `PATCH /api/admin/users/:id/roles` once you have an admin) to see the
administration console.

## Environment configuration

Environments are strictly separated by `NODE_ENV` (`development` | `test` | `staging` | `production`):

- `.env.example` — documents every supported variable (committed).
- `.env.development` — non-secret development values (committed). The JWT secret is auto-generated
  into `.data/secrets/jwt-secret` (gitignored, mode `0600`).
- `.env.test` — test values, in-memory database (committed).
- `.env.production` / `.env.staging` — never committed; supply through the deployment secret
  store. The server **refuses to boot** in staging/production without external `JWT_SECRET` and
  `MEDIA_SIGNING_SECRET` values (>= 32 chars, placeholders rejected), an explicit `DB_PATH`, HTTPS
  `WEB_ORIGIN`, and secure cookies.

See `.env.example` for the full variable reference.

## Status and decision labels

- **Confirmed**: explicitly selected by the product owner.
- **Recommended baseline**: proposed default accepted as the working direction.
- **Open**: must not be invented by an implementation agent.
- **Future**: deliberately excluded from the initial release.

Phase 3 product decisions Q1–Q4 (`local_authorized_fixtures`, `sequential_explicit`,
`pass80_unlimited_best`, `frozen_no_certificate`) are confirmed and documented in
`docs/implementation/phase-3-learning-and-progress.md`. Phase 4 confirms the provisional editorial
tokens as the official visual baseline, web-only security hardening, a visible non-invasive session
watermark with checksum-exact PDF downloads, and DOM/typecheck/build sign-off with automated browser
screenshots **Not run**. Native device registration and offline licensing are deferred; no
concurrent-session cap was invented. O-11 (assignments), O-15 (notes/bookmarks/resume details),
O-03, O-05/O-21, O-22–O-28 and certificate design/verification remain open.

When a decision changes, update the relevant source document and record the reason. Do not
silently contradict another document.

## Visual references

Add selected screenshots to `docs/design/references/`. Use screenshots you have permission to
use. Third-party image files in `REFERENCE-SOURCES.md` are linked, not redistributed; the six local
reference images were inspected as design inputs. Phase 4 DOM/component and CSS/token tests cover the
five requested views, shared states and responsive CSS bands; browser viewport screenshots and
rendered visual comparison were **Not run** (see the Phase 4 implementation log).
