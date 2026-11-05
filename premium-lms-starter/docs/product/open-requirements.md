# Open Requirements and Decisions

Implementation agents must not invent answers to these questions.

## High priority — resolve before relevant implementation

| ID | Decision needed | Why it matters |
|---|---|---|
| O-01 | After a course is withdrawn, do existing purchasers retain access? | Conflicts must be resolved against ongoing access and content rights. |
| O-02 | Who owns course content and what happens when a creator/instructor leaves? | Affects content rights, continuity and withdrawal. |
| O-03 | Who can create, review and publish courses? Is approval required? | Defines workflow and permissions. |
| O-04 | **Resolved (Phase 3):** video, PDF/download, text and quiz launch; audio and assignments do not. | Defines content model and player. See `docs/implementation/phase-3-learning-and-progress.md`. |
| O-05 | Which payment provider, currencies and payment methods? | Required for order and payment implementation. Paystack is not confirmed. |
| O-06 | Android only or Android and iOS? | Changes mobile delivery and offline implementation. |
| O-07 | What are expected student counts and peak concurrent viewers? | Needed to choose and validate video delivery. |
| O-08 | What video sizes, resolutions and download limits are expected? | Affects storage, bandwidth and UX. |

## Resolved in Phase 3 (confirmed product decisions)

- **Q1 `local_authorized_fixtures`** resolves the Phase 3 media portion of O-04/O-22: local
  development video/PDF fixtures are delivered only through backend-authorized scoped grants;
  private Google Drive remains the production provider seam.
- **Q2 `sequential_explicit`** resolves O-09 for Phase 3: every lesson is required in module/lesson
  order; explicit completion for video/text/download, passing for quizzes, no completion from page
  visits or downloads; course completion requires all required lessons.
- **Q3 `pass80_unlimited_best`** resolves the Phase 3 portion of O-10: objective auto-grading,
  80% pass, unlimited retakes, every attempt recorded, best score per quiz, course average of best
  scores, answer keys never sent to the browser. Question randomization is not implemented.
- **Q4 `frozen_no_certificate`**: freeze the active completion-rule version on enrolment; record
  course completion and gradebook; no certificate issuance in Phase 3. Certificate
  design/verification remains open.

See `docs/implementation/phase-3-learning-and-progress.md` for the authoritative implementation
notes and verification evidence.

## Learning and content

- O-09: **Resolved for Phase 3** by Q2; future per-course configuration options remain open.
- O-10: **Resolved for Phase 3** by Q3; question randomization and subjective assessment remain open.
- O-11: Assignment submission and instructor review requirements.
- O-12: How major course editions differ from included corrections.
- O-13: Whether course previews are offered.
- O-14: Whether students can ask questions or contact course support.
- O-15: Whether learners can take notes, bookmark lessons or resume at playback position.

## Purchase and commercial policy

- O-16: Can course prices change after publication?
- O-17: Can a student purchase a course for another account?
- O-18: Are bundles, coupons or promotions needed at launch?
- O-19: Can administrators grant scholarship or support access?
- O-20: Detailed refund, duplicate payment, reversal and chargeback handling.
- O-21: Currency, tax display, invoices and receipts.

## Offline and device rules

- O-22: Which media/material types may be downloaded?
- O-23: What happens when an offline licence expires while the device remains offline?
- O-24: Device identity mechanism and privacy implications.
- O-25: Repeated replacement limits or cooldown, if any.
- O-26: Whether old offline content can remain playable until its existing licence expires after replacement.
- O-27: Download quality selection, resumability, storage limits and deletion UX.
- O-28: Whether offline quizzes/assessments are allowed.

## Operations, legal and deployment

- O-29: Notification channels and triggers.
- O-30: Backup frequency, retention and recovery objectives.
- O-31: Google Drive outage behaviour and support procedure.
- O-32: Copyright complaint and content takedown process.
- O-33: Data retention, privacy notice, account deletion and applicable legal review.
- O-34: Hosting/deployment environment and operational ownership.
- O-35: Monitoring, support and incident response.
- O-36: Whether future products include live training, mentorship, subscriptions or corporate learning.

## Recommended order

Resolve O-01, O-03 through O-08 before committing to detailed implementation architecture. O-04, O-09 and O-10 are resolved for the implemented Phase 3 scope by Q1–Q3 above; resolve each remaining decision before the affected future feature is implemented.
