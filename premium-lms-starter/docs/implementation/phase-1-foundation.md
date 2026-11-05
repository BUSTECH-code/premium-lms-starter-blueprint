# Phase 1 — Foundation build log

Status: implemented and verified (see “Verification evidence” below).
Scope per `docs/implementation/development-phases.md` → Phase 1: repository setup and
conventions, environments and secret management, database and migrations, authentication and
authorization foundation, logging and error handling.

## What was built

| Area | Implementation |
|---|---|
| Monorepo | npm workspaces: `apps/api` (Express 5 + TS), `apps/web` (React 19 + Vite), `packages/db` (migrations + repositories). TypeScript project references; Node >= 22. |
| Environments | `NODE_ENV`-selected config loaded by `apps/api/src/config/env.ts` (pure, zod-validated `parseEnv` + file/process layered `loadEnv`). Committed: `.env.example`, `.env.development`, `.env.test`. Staging/production files are never committed. |
| Database | PostgreSQL schema in `packages/db/src/migrations/0001_init.sql`, RBAC seed in `0002_rbac_seed.sql`, transactional runner with checksum tamper detection (`schema_migrations`). Engine: PGlite (real Postgres, embedded) — production hosting decision O-34 remains open; `DbClient` is the swap point. |
| Authentication | argon2id (OWASP parameters), opaque rotating refresh tokens (SHA-256 at rest) + short-lived HS256 JWT access tokens, both in `httpOnly` cookies; server-side sessions with immediate revocation; refresh-token reuse detection; login/register rate limiting; timing-equalised login; generic credential errors. |
| RBAC | Roles `student` / `instructor` / `admin`; permissions `users.read`, `users.manage_roles`, `audit.read` (admin only). Deny-by-default middleware (`authenticate`, `requirePermission`, `requireRole`); frontend `RequireAuth` / `RequireAccess` guards mirroring the same rules. |
| API surface | `GET /api/health`; `POST /api/auth/{register,login,refresh,logout}`; `GET /api/auth/me`; `GET /api/admin/users`; `PATCH /api/admin/users/:id/roles`; `GET /api/admin/audit-events`. |
| Frontend | Working register/login/logout with silent token refresh (single-flight), guarded routes, account page, admin console (user list, role editor, audit view), 403/404 pages, accessible form states. |
| Logging & errors | pino structured logs with mandatory redaction of credentials/tokens; uniform `{error:{code,message,details?}}` contract; unexpected errors logged server-side and masked from clients; security headers (`nosniff`, `DENY`, `no-store`, HSTS in prod-like envs). |

## Decisions made (engineering defaults — product decisions stay open where marked)

1. **Custom auth, cookies over JS-accessible tokens.** Aligns with the security document’s
   required controls (rotation/revocation, CSRF defence, secure cookies). Open items in
   `docs/security/authentication-and-authorization.md` (email verification, MFA, password reset,
   session duration policy) remain **open** and were not implemented.
2. **Token lifetimes:** access 15 minutes, refresh/session 7 days (absolute, no sliding
   extension). Recommended baseline pending an approved session policy.
3. **Password policy:** minimum 8 characters (NIST-style length-only rule), maximum 512 to bound
   hashing cost. Final registration policy is an open decision.
4. **Default role on registration:** `student` (primary actor per `docs/product/user-roles.md`).
5. **RBAC baseline:** only permissions grounded in the documented *potential responsibilities*
   of administrators were granted. Instructor content permissions are **withheld pending O-03**
   (who may create/review/publish). The final permission matrix remains open.
6. **Safety guard:** an admin cannot remove their own admin role (`cannot_demote_self`) to avoid
   locking out the last administrator.
7. **CSRF:** SameSite=Lax (access) / Strict (refresh) cookies + server-side Origin check on
   state-changing requests (configured origins, or `X-Forwarded-Host` match for proxied setups).
8. **Rate limiting:** in-memory sliding window (per IP+email and per IP for login, per IP for
   registration). Single-instance only — must move to a shared store when multi-instance
   deployment is decided (O-34).
9. **Schema statuses** follow the proposed state models in `docs/architecture/state-machines.md`;
   no transition logic beyond Phase 1 scope was implemented, and no open rule was invented.

## Deletion / history policy encoded in the schema

- Purchase, entitlement, enrolment, progress and audit history use `ON DELETE RESTRICT`
  (or `SET NULL` for audit actors) — never cascade-deleted.
- Structural children (modules → lessons) cascade, but progress references block destructive
  removal of lessons/courses/users.
- Sessions cascade with their user (credentials are not business history).

## Verification evidence (actually run)

| Check | Command | Result |
|---|---|---|
| Unit + integration tests | `npm test` | **126 passed / 126** (11 files: migrations, schema constraints, repositories/RBAC seed, auth flows, RBAC endpoint matrix, security headers/CORS/CSRF, env, passwords, tokens, rate limiter, web route-access logic) |
| Type checking | `npm run typecheck` | **passed** (`tsc -b` for api/db + `tsc --noEmit` for web) |
| Production build | `npm run build` | **passed** (backend compile + Vite bundle, 274 kB JS / 8.6 kB CSS pre-gzip) |
| Migrations | `npm run migrate` | applied `0001_init`, `0002_rbac_seed`; re-run is a no-op; checksum tamper detection tested |
| Explicit migration failure | covered in tests | failing migration rolls back; earlier migrations stay applied |
| Manual HTTP smoke | dev servers + curl (see completion report) | register → login → me → refresh rotation → logout verified against a live server |

Test evidence policy per `docs/implementation/verification-strategy.md`: every check above was
run and its output observed. **Not run:** browser/visual verification (no browser automation
available in this environment) — visual acceptance remains a Phase 2 requirement.

## Known limitations / follow-ups

- Visual design tokens are **provisional** (exact tokens are an open design decision); the auth
  and admin UI follows the premium editorial direction but has not had screenshot-based visual
  acceptance.
- PGlite is a single embedded Postgres process — fine for development/test and single-instance
  staging; a managed PostgreSQL service swap is pending O-34 (interface already isolated).
- In-memory rate limiting is per-process (documented above).
- No email verification, password reset, or MFA (open decisions).
- No course/commerce/progress API yet — Phase 2/3/4 scope; tables and constraints exist and are
  tested so later phases build on a stable schema.

> **Phase 4 status update (2026-11-05):** the provisional-token note above is superseded. The exact editorial tokens are now **Confirmed** as the official Phase 4 baseline in `docs/design/design-system.md` and `apps/web/src/styles/tokens.css`. This historical Phase 1 log is retained for context.
