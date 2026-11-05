# Development Phases — Historical Proposed Sequence

> **Active implementation note (2026-11-05).** The active Phase 3 prompt defines Phase 3 as the
> learning/progress engine after the already-implemented Phase 1 foundation and Phase 2
> catalogue/checkout/enrolment work. This historical file lists content management as Phase 3,
> commerce as Phase 4 and student learning as Phase 5. The active prompt takes precedence: the
> learning/progress engine is implemented and verified as **Phase 3** in
> `docs/implementation/phase-3-learning-and-progress.md`. Phase 4+ (mobile/offline devices,
> operations, certificates and public-site polish) is not started.

Do not begin all phases at once. Each phase requires approved scope and acceptance criteria.

## Phase 0 — Discovery and decisions
- Inspect repository and existing technology (if any).
- Resolve high-priority open requirements.
- Confirm brand direction and collect visual references.
- Approve domain model and architecture.
- Define measurable non-functional targets.

Exit: approved requirements baseline and architecture decisions.

## Phase 1 — Foundation
- Repository setup and conventions.
- Environments and secret management.
- Database and migrations.
- Authentication and authorization foundation.
- Design tokens and shared component foundation.
- Logging and error handling.

Exit: secure foundation with automated checks.

## Phase 2 — Public experience and course discovery
- Public website.
- Course catalogue.
- Course details.
- Search/filter only as approved.
- Responsive visual verification.

Exit: accurate course discovery with premium visual acceptance.

## Active Phase 3 — Learning & progress (implemented)

- Responsive student course player and learning dashboard.
- Server-authoritative lesson state machine and sequential unlocks.
- Offline-safe progress sync with exact-once/stale/duplicate handling.
- Objective quiz auto-grading, best-score gradebook and frozen course completion rules.
- Authorized short-lived scoped grants for local development media.
- No certificate issuance (approved Q4).

Exit: end-to-end learner journey verified by unit, integration and DOM tests; see
`docs/implementation/phase-3-learning-and-progress.md`. Browser visual acceptance was not run.

## Historical Phase 3 — Course content management
- Course/module/lesson management.
- Media asset metadata and private provider integration.
- Draft/review/publish workflow as approved.
- Content versioning rules.

Exit: authorized operators can manage real course content.

## Phase 4 — Commerce and entitlements
- Orders and payment provider integration.
- Server-side verification.
- Idempotent webhooks and reconciliation.
- Entitlement and enrolment handling.
- Purchase history and receipts as approved.

Exit: payment-to-access flow verified against success and failure cases.

## Phase 5 — Student learning
- Student dashboard and course library.
- Authorized lesson access.
- Video learning environment.
- Materials library.
- Progress tracking.
- Quizzes/assignments only as approved.
- Certificates and verification.

Exit: end-to-end learner journey verified.

## Phase 6 — Mobile and offline
- Confirm mobile platform and implementation technology.
- Device registration and replacement.
- Protected downloads and offline licences.
- Resume/retry/integrity handling.
- Offline playback and renewal.

Exit: real-device tests demonstrate the approved offline behaviour.

## Phase 7 — Operations and launch readiness
- Admin operations and support workflows.
- Course withdrawal.
- Notifications.
- Reports and audit.
- Backup/recovery tests.
- Security, performance, accessibility and end-to-end testing.

Exit: launch checklist passed with evidence.

## Future
Live tutoring, live classes, mentorship and other learning products require separate discovery and approval.
