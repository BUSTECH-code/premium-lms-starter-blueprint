# Phase 3 — Learning & Progress Engine

**Status:** Implemented and verified (2026-11-05).  
**Source of truth:** active Phase 3 prompt, `docs/architecture/state-machines.md`,
`docs/workflows/learning-and-progress.md`, and the four approved product decisions below.  
**Verification:** full `npm test`, `npm run typecheck`, `npm run build`, `npm run migrate`, and
idempotent `npm run seed:fixtures` all pass. See "Verification evidence".

> **Phase-numbering note.** `development-phases.md` is a historical *proposed* sequence in which
> content management is Phase 3 and student learning is Phase 5. The active Phase 3 prompt defines
> this learning/progress engine as Phase 3 after the already-implemented Phase 1 foundation and
> Phase 2 catalogue/checkout/enrolment work. The active prompt wins; the historical numbering is
> retained only as context.

## 1. Approved product decisions (Q1–Q4)

| ID | Decision | Implemented rule |
|---|---|---|
| **Q1 `local_authorized_fixtures`** | Development media | Video, text, quiz and download lessons are supported. In-repo `lesson-intro.mp4` / `lesson-notes.pdf` fixtures are delivered only through backend-issued, short-lived scoped grants that re-check entitlement and sequential lesson unlock. Private Google Drive remains the documented provider seam; no public links, client-visible provider references or credentials. |
| **Q2 `sequential_explicit`** | Progression | Every lesson is required in `module_position → lesson_position` order. Video/text/download lessons complete **only** by an explicit client `complete` event. Quiz lessons complete only by an internal server `quiz_passed` event. Page visits, 100% playback and downloads never complete a lesson. A later lesson unlocks only after **all** earlier lessons are completed. |
| **Q3 `pass80_unlimited_best`** | Assessment | Objective auto-grading; `>= 80%` passes; unlimited retakes. Every attempt is recorded, best score per quiz is retained, and the course gradebook averages the best scores across quizzes. Answer keys (`isCorrect` / correct choice IDs) are never serialized to the browser. |
| **Q4 `frozen_no_certificate`** | Completion | The active completion-rule version is frozen on enrolment (`enrollments.criteria_version`). Course completion and gradebook are recorded. **No certificate is issued**; `certificate_issued` is a permitted future state but Phase 3 deliberately never writes it. |

These decisions resolve O-04 (launch lesson types), O-09 (completion criteria) and O-10 (quiz
passing score / retakes / attempt review) for the implemented Phase 3 scope. O-11 assignment
approval, O-15 notes/bookmarks/resume-detail decisions, O-03 authoring/publishing authority,
O-05/O-21 payment/currency detail, and certificate design/verification remain open. The player
stores a reliable playback position and offers an explicit "Resume from …" action; auto-resume,
notes and bookmarks are **not** silently invented.

## 2. Scope delivered

### Database / migration

- `packages/db/src/migrations/0004_learning_engine.sql` adds:
  - `lessons.kind` CHECK (`video | text | quiz | download`) and kind-change protection once content exists.
  - Versioned `course_completion_rules` with frozen v1 criteria (`all_required_lessons`,
    `module_position_then_lesson_position`, explicit video completion, 80% quiz pass) plus a
    course-insert trigger and one-active-version index.
  - `enrollments.criteria_version` backfill/FK/before-insert freeze trigger, and
    `course_completion` with `ensure_course_completion()` backfill/insert trigger.
  - `media_assets`, `lesson_content`, `media_asset_grants` (SHA-256 token hash, user, lesson,
    asset, purpose, expiry).
  - `quizzes`, `quiz_questions` (private answer-key JSONB + validation trigger), `quiz_attempts`,
    `quiz_gradebook`, `course_gradebook`.
  - `lesson_progress.revision`, `completion_source`, `last_event_at`, consistency CHECK/backfill,
    `progress_client_sequences` and `progress_events` with exact-once/stale/duplicate outcomes.
- Migration checksums are computed from the SQL file and recorded by `runMigrations`. A modified
  applied migration is rejected by the existing tamper-detection rule; new tests explicitly cover
  `0004_learning_engine` checksum recording and tampering.

### Pure domain logic

- `packages/db/src/domain/lesson-progress.ts` — terminal `completed`, monotonic progress/playback,
  only `complete` / `quiz_passed` can complete, stale-sequence classification.
- `packages/db/src/domain/learning-order.ts` — sequential unlock requiring all earlier lessons,
  progress percent, suggested/next/previous lesson helpers.
- `packages/db/src/domain/quiz-grading.ts` — objective grader, canonical answer comparison, answer-key
  stripping for public questions.
- `packages/db/src/domain/index.ts` — barrel.

### Repositories and API

- `packages/db/src/repos/learning-errors.ts`, `learning.ts`, `assessment.ts`, `media.ts` —
  stable learning errors, transactional progress + course completion evaluation, gradebook best-score
  aggregation, quiz attempt idempotency, and 300-second SHA-256 scoped grants.
- `apps/api/src/learning/routes.ts` exposes:
  - `GET /api/learning/courses/:slug` — player bootstrap/curriculum/progress/gradebook/completion.
  - `GET /api/learning/courses/:slug/gradebook`.
  - `GET /api/learning/lessons/:lessonId` — authorized lesson detail; quiz questions omit answer keys.
  - `POST /api/learning/lessons/:lessonId/progress/events` — idempotent offline-safe batches.
  - `POST /api/learning/lessons/:lessonId/quiz/attempts` — transactional auto-grading/gradebook.
  - `POST /api/learning/lessons/:lessonId/media` — refresh a scoped delivery grant.
- `apps/api/src/media/routes.ts` + `media/provider.ts` — `GET`/`HEAD /api/media/content` with grant,
  purpose, byte-range, entitlement and unlock re-checks; `LocalFixtureMediaProvider` validates safe
  basenames, exact size and SHA-256 checksum. A future `GoogleDriveMediaProvider` implements the
  same seam; no fake integration was added.
- `apps/api/src/commerce/routes.ts` and `packages/db/src/repos/commerce.ts` — enrolled-library API
  now returns server-derived progress, completion status, lesson counts and gradebook average.
- `apps/api/src/scripts/seed-fixtures.ts` — idempotently seeds 8 courses, 4 categories and 25
  learning lessons, assigns all four lesson kinds, inserts private quiz questions and registers
  local fixture assets by SHA-256/size.

### Web UI

- `apps/web/src/learning/` — typed API client, pure presentation helpers, offline progress queue,
  React `useProgressSync` hook and `CoursePlayerPage`.
- Responsive two-column player: breadcrumb, course header, progress bar, module-grouped curriculum
  with text markers (`✓ / ◐ / ○ / —`) for completed/in-progress/not-started/locked, gradebook panel,
  previous/next navigation, sync status and explicit "Mark complete".
- Video player with saved-position resume and throttled `position` events; text reading; secured
  download link; quiz form for single/multiple/true-false questions with pass/fail review, unlimited
  retakes and no answer keys. Reaching video end or downloading never sends a completion event.
- Offline queue uses a stable client ID, per-lesson monotonic sequence, exact-once client event IDs,
  localStorage persistence, reconnect `online` flush, network-error retention and terminal-4xx drop.
- `AccountPage` is now a learning dashboard with active-course/lesson/gradebook stats, per-course
  progress bars and "Continue learning" / "Open course" links. `CourseDetailPage` routes entitled
  learners to `/learn/:slug`; `App.tsx` mounts auth-guarded `/learn/:slug` and
  `/learn/:slug/:lessonId` routes. Phase 3 CSS is appended to `styles/app.css`; design tokens remain
  provisional and centralized in `styles/tokens.css`.

## 3. Verification evidence

Commands were run from `/home/user/premium-lms-starter-blueprint/premium-lms-starter`.

| Check | Result |
|---|---|
| `npm run migrate` | Passed. `applied: []`, `alreadyApplied: ["0001_init","0002_rbac_seed","0003_catalog_checkout","0004_learning_engine"]`. Confirms the current edited migration is recorded with its current checksum. |
| Migration checksum/tamper tests | Passed in `packages/db/tests/migrations.test.ts`: fresh apply records the exact `0004_learning_engine` SHA-256; a tampered recorded checksum is rejected with `modified after being applied`. |
| `npm run seed:fixtures` | First run: `8` courses, `4` categories, `25` learning lessons. Second run: `0 / 0 / 0` (idempotent). |
| `npm test -- --reporter=dot` | **26 test files / 242 tests passed**, 0 failed. |
| `npm run typecheck` | Passed (`tsc -b` + web typecheck). |
| `npm run build` | Passed. Vite output `dist/assets/index-D1xvlsrC.css` 20.36 kB, `dist/assets/index-DM7QQrYH.js` 316.38 kB. |

### Test coverage added

- `packages/db/tests/learning-domain.test.ts` — state transitions, terminal completion, monotonic
  progress, stale sequences, sequential unlock, 80% threshold, multiple-choice exact sets, public
  DTO answer-key stripping.
- `packages/db/tests/migrations.test.ts` — Phase 3 migration tables/checksum and tamper detection.
- `packages/db/tests/schema-constraints.test.ts` — updated for the new
  `lesson_progress_completion_consistent` invariant (completed requires 100%, timestamp and source).
- `apps/api/tests/learning-journey.test.ts` — full HTTP integration: frozen criteria version,
  skipping ahead, explicit vs page-visit/100%-playback completion, rapid clicks, offline replay
  duplicates, stale sequence, quiz auto-grading, duplicate/conflicting submissions, unlimited
  retakes, best-score gradebook averages across two quizzes, course completion/no certificate,
  library progress DTO, scoped media bytes/ranges/HEAD/invalid-range, grant TTL, purpose mismatch,
  unauthenticated/cross-user/revoked/expired authorization.
- `apps/web/src/learning/player-state.test.ts`, `progress-sync.test.ts`,
  `course-player.test.tsx` — pure helpers, offline queue/reconnect/exact-once ordering, and DOM
  tests for curriculum, explicit completion, download non-completion, quiz retakes, offline flush
  and locked-lesson state.
- `apps/web/src/pages/account-page.test.tsx` — dashboard progress/gradebook views, including an
  older payload without `learning`.
- `apps/web/src/pages/course-detail.test.tsx` — entitled CTA now links to the course player.

### Not run / limitations

- **Browser visual acceptance:** Not run. No live browser preview, viewport screenshots or
  side-by-side reference-image comparison were produced in this environment. DOM component tests
  and the production build are not a substitute for visual inspection; this remains a follow-up.
- **Real-device offline/E2E:** Not run. Offline behaviour is verified through the client queue unit
  tests and API integration replay tests, not real devices.
- **Certificates:** Not implemented, by approved Q4 (`frozen_no_certificate`).
- **Private Google Drive adapter:** Not implemented; no credentials/file IDs are available. Only the
  approved `local_fixture` provider and a documented `MediaProvider` seam are present.
- **Still-open decisions:** O-11 assignments, O-15 notes/bookmarks/resume details, O-03
  authoring/publishing authority, O-05/O-21 payment/currency details, O-34 hosting, certificate
  design/verification, exact design tokens and mobile/offline device rules.

## 4. Completion report

Phase 3 is complete for the active prompt's scope: the migration is applied and checksummed,
backend state machines / quiz grading / gradebook / authorized media delivery are implemented, the
responsive player and dashboard are implemented, and the requested unit, integration and DOM/E2E-style
test scenarios pass. All four approved product decisions are enforced server-side and reflected in
the UI. Phase 3 must still not be interpreted as including certificate issuance, real-device offline
support, private Google Drive integration or browser visual sign-off.
