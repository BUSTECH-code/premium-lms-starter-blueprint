# Verification Strategy

## Verification layers

### Unit tests
- Domain calculations and state transitions.
- Completion eligibility.
- Entitlement decisions.
- Payment event idempotency logic.
- Device limit and replacement rules.

### Integration tests
- Database transactions and constraints.
- Payment verification/webhook processing.
- Authorization for course and media access.
- Google Drive/provider adapter behaviour using controlled test doubles.
- Download/licence renewal and revocation flows.

### End-to-end tests
- Register/login and account recovery.
- Course discovery and purchase.
- Payment success, pending and failure.
- Course access after verified purchase.
- Lesson progress and completion.
- Certificate issuance.
- Device registration/replacement.
- Offline download and playback on supported real devices.
- Course withdrawal and notifications.

### Security tests
- Cross-user access attempts.
- Role/permission boundary tests.
- Forged or duplicate payment events.
- Direct media URL/file-ID access attempts.
- Expired/revoked entitlement and licence attempts.
- Rate limits and secret leakage checks.

### Visual and usability verification
- Browser screenshots at agreed viewports.
- Compare actual rendering against approved reference images.
- Test keyboard navigation and focus.
- Test loading, empty, error and success states.
- Test on realistic mobile viewport and network conditions.

## Evidence policy

A check is only reported as passed if it was run and its result observed. Distinguish:
- Not run.
- Blocked.
- Failed.
- Passed.

Do not substitute a successful build for functional verification. Do not substitute functional tests for visual inspection.
