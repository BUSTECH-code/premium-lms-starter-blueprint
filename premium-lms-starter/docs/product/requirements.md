# Product Requirements

## Status legend

- **Confirmed** — explicitly selected by product owner.
- **Recommended baseline** — current recommended direction; confirm before treating as immutable.
- **Open** — needs a product decision.
- **Future** — intentionally deferred.

## Initial release functional requirements

### Public discovery
- **Open:** Public landing page and brand content structure.
- **Recommended baseline:** Browse a course catalogue.
- **Open:** Search, category taxonomy and filter criteria.
- **Recommended baseline:** Course detail page presents description, outcomes, curriculum, instructor attribution where available, format, duration if known, price and purchase action.
- **Open:** Whether preview lessons or sample materials are available.

### Identity and access
- **Open:** Registration, login, email verification, password reset and account recovery details.
- **Open:** Final roles and permission matrix.
- **Recommended baseline:** Server-side authorization for every protected operation.
- **Confirmed:** A student may have at most two active registered devices.

### Purchase and entitlement
- **Confirmed:** Recorded courses are purchased individually through one-time payments.
- **Confirmed:** Ordinary course entitlement does not expire after purchase.
- **Confirmed:** Access is personal and non-transferable.
- **Confirmed:** Successful server-verified payment grants entitlement.
- **Confirmed:** Failed, pending or unverified payment does not grant entitlement.
- **Confirmed:** Payment, order, enrolment and entitlement are distinct records/concepts.
- **Confirmed (Task 1):** Paystack is the live payment provider, selected explicitly by the owner.
- **Open:** Supported currencies, payment methods and reconciliation policy. `NGN` remains a development placeholder.
- **Confirmed:** No voluntary refunds as the intended policy, subject to legally required refunds, erroneous/duplicate charges, payment reversals, chargebacks and applicable provider/legal requirements.

### Course and lesson management
- **Recommended baseline:** Courses contain ordered modules and lessons.
- **Confirmed (Phase 3 Q1):** Supported lesson types for the implemented learning engine are video,
  PDF/download, text and quiz. Audio and assignments are not implemented.
- **Open:** Who may create, review and publish courses.
- **Confirmed:** Corrections and updates to a purchased course are included.
- **Open:** Versioning policy for major editions versus minor corrections and supplementary materials.

### Learning and assessment
- **Recommended baseline:** Record lesson progress independently from download state.
- **Confirmed (Phase 3 Q2):** Every lesson is required in module/lesson order; video, text and
  download lessons complete only by explicit action; quizzes complete only by passing; page visits,
  100% playback and downloads never complete a lesson.
- **Confirmed (Phase 3 Q3):** Objective questions are auto-graded; 80% passes; retakes are unlimited;
  every attempt is recorded; best score per quiz and course average of best scores are retained;
  answer keys are never sent to the browser. Question randomization is not implemented.
- **Confirmed (Phase 3 Q4):** The active completion-rule version is frozen on enrolment. Course
  completion and gradebook are recorded. **No certificate is issued in Phase 3**; certificate
  design/verification remains open.
- **Open:** Assignment approval, subjective assessment and future per-course criteria configuration.

### Content storage and delivery
- **Confirmed:** Private Google Drive is the initial production content repository.
- **Confirmed (Phase 3 Q1):** Development uses in-repo local video/PDF fixtures served only through
  backend-authorized short-lived scoped grants that re-check entitlement and lesson unlock. No
  public links or client-visible credentials/references are exposed. A `MediaProvider` seam is
  retained for the future Drive adapter; no fake Drive integration is implemented.
- **Confirmed:** Backend uses the Drive API in production; database stores private provider references/file IDs and metadata.
- **Confirmed:** Do not expose public Drive links or service credentials to clients.
- **Recommended baseline:** Use a storage-provider abstraction so the storage provider can change later.
- **Open:** Video delivery method, transcoding, adaptive streaming, concurrency and bandwidth strategy.
- **Open:** File-size, quality and download limits.

### Offline learning
- **Confirmed:** Offline downloads are for in-app use, not ordinary MP4 export to general storage.
- **Confirmed:** Offline playback authorization lasts 90 days and requires online renewal.
- **Confirmed:** Offline licence expiry does not expire the underlying purchased course entitlement.
- **Recommended baseline:** Encrypted app-private storage, integrity verification, resumable downloads and personalised watermarking.
- **Open:** Which material types can be downloaded.
- **Open:** What happens when a licence expires while the device remains offline.
- **Open:** Device identification and repeated replacement controls.

### Course withdrawal
- **Confirmed:** At least 30 days' notice before planned withdrawal.
- **Confirmed:** Preserve purchase and learning history.
- **Confirmed:** Record affected students, reason, decision date, notice date, scheduled date and notification delivery status.
- **Recommended baseline:** Stop new sales when withdrawal is scheduled.
- **Open:** Existing purchaser access after withdrawal; recommendation is to preserve access where rights permit, but this must be explicitly approved.
- **Open:** Exception process if legal rights require content removal.

### Administration and operations
- **Open:** User, course, payment, content and support administration permissions.
- **Open:** Notification channels and event triggers.
- **Open:** Analytics and reporting requirements.
- **Open:** Backup, disaster recovery, monitoring and support processes.
- **Open:** Copyright infringement reporting and takedown workflow.

## Non-functional requirements

- **Security:** Authentication, authorization, secure sessions, secret management, audit trails and safe file delivery.
- **Privacy:** Collect only necessary personal data; define retention, access and deletion rules.
- **Reliability:** Payment and entitlement changes must be transactionally safe and retry-safe.
- **Performance:** Design for mobile devices and variable network conditions; numeric targets remain open.
- **Accessibility:** Target WCAG 2.2 AA as a recommended standard, subject to validation.
- **Maintainability:** Modular monolith with explicit domain boundaries.
- **Observability:** Structured logs, operational metrics and actionable error reporting without exposing secrets.
- **Backup:** Document and test database and media-reference recovery.
- **Scalability:** Validate storage and video delivery against expected learner and concurrency volumes before launch.

## Explicit exclusions

Do not infer or implement live tutoring, mentorship, subscriptions, course bundles, gifts, corporate learning or complex instructor marketplace functionality without approval.

## Confirmed Phase 4 decisions (2026-11-05)

- **Confirmed:** provisional editorial tokens are the official Phase 4 visual baseline; exact values are documented in `docs/design/design-system.md`.
- **Confirmed:** web-only content-protection hardening — short-lived scoped media grants, anti-hotlink referrer/origin checks, audit events, rate limits, no-store headers and progressive-sync tamper checks.
- **Confirmed:** a visible, non-invasive web player watermark with email, short session ID and timestamp; PDF downloads remain checksum-exact and unmutated.
- **Confirmed:** Phase 4 sign-off uses DOM component tests, full typechecking and production build verification; automated browser screenshots were **Not run**.
- **Deferred:** native mobile device registration, native offline licensing and any concurrent-session cap. No 2-session cap was invented.
