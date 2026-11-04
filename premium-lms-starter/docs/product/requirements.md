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
- **Open:** Payment provider, currencies, payment methods and reconciliation policy.
- **Confirmed:** No voluntary refunds as the intended policy, subject to legally required refunds, erroneous/duplicate charges, payment reversals, chargebacks and applicable provider/legal requirements.

### Course and lesson management
- **Recommended baseline:** Courses contain ordered modules and lessons.
- **Open:** Supported lesson types at launch: video, PDF, audio, text, quiz and assignment.
- **Open:** Who may create, review and publish courses.
- **Confirmed:** Corrections and updates to a purchased course are included.
- **Open:** Versioning policy for major editions versus minor corrections and supplementary materials.

### Learning and assessment
- **Recommended baseline:** Record lesson progress independently from download state.
- **Recommended baseline:** Course completion criteria are configurable per course, using platform defaults.
- **Open:** Exact completion rules, quiz attempts, passing scores, assignment approval and retake policy.
- **Recommended baseline:** Issue certificates only after the system verifies the applicable completion rules.

### Content storage and delivery
- **Confirmed:** Private Google Drive is the initial content repository.
- **Confirmed:** Backend uses the Drive API; database stores private provider references/file IDs and metadata.
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
