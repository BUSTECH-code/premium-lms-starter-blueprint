# System Architecture — Recommended Baseline

## Architecture style

Recommended: modular monolith with a shared backend API.

Do not split into microservices for the initial release. Keep clear logical domains and enforce boundaries in code.

## Logical components

1. Web application
   - Public website and course discovery.
   - Student portal.
   - Administrative and content operations interfaces.
2. Backend application/API
   - Authentication and authorization.
   - Business rules and workflows.
   - Payment provider integration.
   - Course and learning services.
   - Authorized content delivery.
   - Device and offline authorization.
3. Database
   - PostgreSQL recommended for central persistent records.
4. Content storage
   - Private Google Drive initially, accessed by backend through Drive API.
   - Provider abstraction to permit later migration.
5. Mobile application
   - Android-first is a proposal, not confirmed.
   - Shared backend API.
   - Protected in-app offline learning.
6. External integrations
   - Payment provider (open).
   - Notification provider (open).
   - Google Drive API.

## Important boundary: database vs media storage

PostgreSQL stores records and references. It does not store the video binaries by default.

The media repository stores actual files. Database records should identify the provider, private file ID, metadata, version and relationship to course content.

## Content delivery caution

Google Drive is an initial private repository, not a guaranteed video streaming CDN. Before launch, validate API quotas, transfer limits, playback experience, concurrency, range-request support and cost. Do not expose public Drive URLs or assume Drive can meet production streaming requirements.

Use a content-provider interface so delivery/storage can be replaced without rewriting course and lesson business logic.

## Web and mobile relationship

Web and mobile share identity, course data, orders, entitlements, progress and backend rules.

The web client can support discovery, purchase, administration, content management and online learning.

Protected offline playback is primarily a mobile capability. Browser offline storage should not be assumed to provide equivalent protection or reliability.

## Deployment assumptions

- Central PostgreSQL service with managed backups.
- Persistent private media storage.
- Secrets held in deployment secret management, not source control.
- HTTPS for all production traffic.
- Separate development, staging and production environments.
- Actual hosting provider and deployment topology remain open.

## Architecture principles

- Server is the authority for payment, entitlement and authorization.
- Use transactions for coupled database changes.
- Make external event processing idempotent.
- Keep UI components separate from domain rules.
- Use explicit interfaces around external providers.
- Log security-sensitive actions without logging secrets or private media tokens.
- Design for recoverability and observability.

## Phase 4 implementation boundaries

- `packages/shared` holds pure SHA-256/canonicalisation helpers shared by API and web; it introduces no runtime service.
- `0005_phase4_content_protection.sql` extends media grants with session/user-agent binding, access counts and last-access timestamps.
- `apps/api/src/media/` owns URL signing, anti-hotlink headers, watermark metadata and authorized delivery; `apps/api/src/learning/routes.ts` owns batch checksum validation and grant issuance.
- `apps/web/src/learning/progress-sync.ts` owns the browser queue/quarantine; it is not a licence or trust boundary.
- `apps/web/src/styles/tokens.css`, `app.css`, `phase4.css` and `components/editorial.tsx` own the confirmed editorial baseline.
- Browser offline storage remains unsuitable for native protected offline playback; native device registration, offline licences and a delivery CDN/provider choice remain Open/deferred.
