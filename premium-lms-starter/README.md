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
| Phase 3+ | Public site polish, learning environment, mobile, operations | Not started |

## Repository map

- `AGENTS.md` — mandatory instructions for coding agents.
- `docs/product/` — product vision, scope, requirements, business rules, roles and open decisions.
- `docs/architecture/` — recommended architecture, domain boundaries, data concepts and state models.
- `docs/workflows/` — key business and learner workflows.
- `docs/design/` — premium visual direction, design principles, visual acceptance criteria and references.
- `docs/security/` — security, content protection, devices and offline-learning principles.
- `docs/implementation/` — delivery phases, task rules, verification strategy and the Phase 1/Phase 2 build logs.
- `apps/api/` — backend API (Express 5 + TypeScript): authentication, RBAC, admin endpoints.
- `apps/web/` — web application (React 19 + Vite): auth flows, guarded routes, admin console.
- `packages/db/` — database package: PGlite client, SQL migrations, RBAC seed, repositories.

## Architecture (Phases 1–2)

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

## Quick start

Requirements: Node.js >= 22.

```bash
npm install          # install workspace dependencies
npm run dev          # start API (:4000) + web (:5173) with migrations applied on boot
npm test             # run the full unit/integration test suite (126 tests)
npm run typecheck    # TypeScript project build + web typecheck
npm run build        # production build (backend compile + web bundle)
npm run migrate      # apply pending database migrations explicitly
```

Open <http://localhost:5173>. Register a student account; promote it to `admin` in the database
(or via `PATCH /api/admin/users/:id/roles` once you have an admin) to see the administration
console.

## Environment configuration

Environments are strictly separated by `NODE_ENV` (`development` | `test` | `staging` | `production`):

- `.env.example` — documents every supported variable (committed).
- `.env.development` — non-secret development values (committed). The JWT secret is auto-generated
  into `.data/secrets/jwt-secret` (gitignored, mode `0600`).
- `.env.test` — test values, in-memory database (committed).
- `.env.production` / `.env.staging` — never committed; supply through the deployment secret
  store. The server **refuses to boot** in staging/production without an external `JWT_SECRET`
  (>= 32 chars, placeholders rejected), an explicit `DB_PATH`, HTTPS `WEB_ORIGIN`, and secure
  cookies.

See `.env.example` for the full variable reference.

## Status and decision labels

- **Confirmed**: explicitly selected by the product owner.
- **Recommended baseline**: proposed default accepted as the working direction.
- **Open**: must not be invented by an implementation agent.
- **Future**: deliberately excluded from the initial release.

When a decision changes, update the relevant source document and record the reason. Do not
silently contradict another document.

## Visual references

Add selected screenshots to `docs/design/references/`. Use screenshots you have permission to
use. Third-party image files in `REFERENCE-SOURCES.md` are linked, not redistributed.
