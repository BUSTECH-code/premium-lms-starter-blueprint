# State Models

These are proposed state models. Confirm open transitions before implementation.

## Order
- Created
- Payment Pending
- Paid
- Failed
- Cancelled
- Partially Refunded (only if supported)
- Refunded
- Reversed / Chargeback

An order's state must be derived from verified payment and adjustment events, not a client redirect.

## Payment attempt
- Initiated
- Pending
- Succeeded
- Failed
- Expired
- Reversed
- Refunded

Provider webhook and reconciliation events may arrive more than once or out of order. Define transition precedence and idempotency.

## Course availability
- Draft
- In Review (only if approval workflow is selected)
- Published
- Withdrawal Scheduled
- Withdrawn

A course being unavailable for new sales does not automatically answer whether existing entitlements remain valid.

## Entitlement
- Active
- Revoked

Ordinary expiry is not used for purchased recorded courses. Revocation requires an auditable reason and actor/source.

## Download
- Requested
- Authorizing
- Downloading
- Paused
- Verifying
- Completed
- Failed
- Cancelled
- Revoked

A download state is not the same as lesson completion.

## Offline licence
- Requested
- Active
- Renewal Due
- Expired
- Revoked

Target duration: 90 days. Renewal requires online authorization. Exact expiry behaviour while offline and revocation propagation remain open.

## Lesson progress
- Not Started
- In Progress
- Completed

Completion definition must be explicit. Do not infer completion merely from a download or page visit.

## Course completion
- Not Eligible
- In Progress
- Completed
- Certificate Issued (certificate may be a separate record/state)

Completion criteria are configurable per course as a recommended baseline. Exact criteria remain open.

## Device
- Active
- Replaced / Revoked

Maximum two active devices per learner. Replacements must be audited. Offline devices cannot receive immediate remote revocation.
