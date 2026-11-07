# Security: Authentication and Authorization

## Principles

- Authenticate users securely and protect sessions.
- Enforce authorization server-side for every protected resource and mutation.
- Deny by default.
- Separate authentication (who the user is) from authorization (what they may do).
- Use least privilege for administrators, support and content operators.
- Protect secrets and sensitive user/payment data.
- Audit sensitive actions.

## Required controls

- Secure password hashing using a current, well-maintained password hashing algorithm.
- Secure session cookie/token handling and rotation/revocation strategy.
- HTTPS in production.
- CSRF protection where applicable to the chosen session architecture.
- Rate limits for login, password reset, payment initiation and sensitive endpoints.
- Server-side input validation.
- Authorization tests for cross-user and cross-role access.
- Secret management outside source control and browser bundles.
- Safe error messages and structured security logging.

## Open decisions

- Authentication provider or custom auth.
- Email verification requirements.
- MFA requirements for administrators.
- Session duration and concurrent session policy.
- Account recovery process.
- Support access model and impersonation prohibition/controls.
- Data retention and account deletion policy.

## Phase 4 additions

- `MEDIA_SIGNING_SECRET` is required explicitly in staging/production and derived from `JWT_SECRET` only in development/test.
- Media grant and media content endpoints have separate rate limiters and audit events.
- Signed URLs are bound to the authenticated session; a different session receives `media_session_mismatch` rather than access.
- Anti-hotlink checks add no-store, noindex, `Vary` and `Cross-Origin-Resource-Policy` headers.
- Session duration and concurrent session/device policy remain **Open**; Phase 4 does not implement a concurrent-session cap.

## Task 1 Paystack additions

- `PAYSTACK_SECRET_KEY` is server-only. In staging/production it must be a live `sk_live_` key matching a live `pk_live_` public key; no real credential is committed.
- `/api/checkout/webhook` is exempt from browser Origin/CSRF checks because it is authenticated by a constant-time SHA-512 HMAC over the exact raw body in `x-paystack-signature`. Missing, malformed, forged or body-mutated signatures return `401 invalid_signature`.
- `/api/checkout/initialize` and `/api/checkout/verify/:reference` remain authenticated, owner-scoped and checkout-rate-limited. Callback URLs and Paystack API origins are validated against configured environment values, never client input.
- `VITE_PAYSTACK_PUBLIC_KEY` is public browser configuration only; the secret key is never placed in a Vite bundle.
