# Business Rules

## Confirmed rules

### Course purchase
1. A recorded course is sold as an individual one-time purchase.
2. A normal purchase grants ongoing course access; there is no ordinary entitlement expiry.
3. The licence is personal and non-transferable.
4. Corrections and updates to the purchased course are included.
5. An entirely new course or materially distinct major edition may be sold separately; exact version boundary is open.

### Payment and entitlement
1. Create an order before payment is initiated.
2. Payment status must be verified server-side with the payment provider.
3. Only a verified successful payment may grant the entitlement.
4. Pending, failed, cancelled or unverified payments do not grant access.
5. Webhook processing must be idempotent.
6. Store provider reference and enough evidence to reconcile a payment.
7. Keep order, payment, entitlement and enrolment separate.
8. No voluntary refunds is the intended policy, but legally required refunds, duplicate/erroneous charges, reversals, chargebacks and provider obligations must be supported.

### Entitlement
1. Entitlement is associated with a user and course.
2. Entitlement is active or revoked; ordinary expiry is not used for purchased recorded courses.
3. Revocation requires a reason, actor/source and timestamp.
4. Admin grants, promotions or other entitlement sources remain open and must not be assumed.

### Course updates and withdrawal
1. Minor corrections and updates are included for existing purchasers.
2. Planned withdrawal requires at least 30 days' notice.
3. Preserve purchase and learning history.
4. Track affected learners and notification delivery.
5. Existing purchaser access after withdrawal remains an open policy decision.
6. Recommended: stop new sales once withdrawal is scheduled; preserve existing access where legal rights permit.

### Devices and offline learning
1. Maximum two active registered devices per student.
2. Device replacement is intended to be self-service and immediate, without routine admin approval.
3. Replacement revokes the old device's server-side access and registers the new device.
4. Repeated replacement abuse monitoring is recommended.
5. Offline licence duration is 90 days.
6. Offline licence expiry does not expire course entitlement.
7. Renewal requires online authorization.
8. Offline files are intended to remain in app-private protected storage.
9. A device that is offline cannot receive an immediate remote revocation. This limitation must be communicated and handled in licence design.

## Recommended baseline requiring final approval

- Stop new purchases when a course enters Withdrawal Scheduled.
- Preserve existing purchasers' access after withdrawal where the platform retains rights.
- Allow self-service device replacement, with audit history and abuse monitoring.
- Use configurable course completion criteria with platform defaults.
- Keep lesson progress independent from downloaded-file state.

## Prohibited assumptions

- Do not promise zero piracy.
- Do not equate a 90-day offline licence with a 90-day course entitlement.
- Do not grant entitlement from a browser redirect or client-side payment success message.
- Do not expose private Drive links as a substitute for authorization.
- Do not delete learning progress when a learner deletes a downloaded file.
- Do not silently revoke purchased access because a course is no longer sold.
