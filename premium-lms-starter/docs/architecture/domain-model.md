# Domain Model — Conceptual Baseline

This is a conceptual model, not a final SQL schema. Field types, constraints and cardinalities must be designed after open requirements are resolved.

## Identity
- User
- Role / Permission
- Account status
- Authentication credential/session

## Course management
- Course
- Course version
- Module
- Lesson
- Course publication/availability record
- Course withdrawal notice
- Course creator/owner relationship (policy open)

## Commerce
- Order
- Order item
- Payment
- Payment event / webhook receipt
- Refund or reversal record

## Access
- Course entitlement
- Enrolment
- Entitlement audit event

Entitlement is the authority for access. Enrolment may represent a learner's participation or course workspace. Do not use a payment row as the sole access check.

## Content
- Media asset
- Lesson asset relationship
- Storage provider
- Asset version
- Download authorization

Possible media metadata:
- provider
- private provider file ID
- MIME type
- file size
- checksum
- duration, if video/audio
- version
- processing status
- created/updated timestamps

Do not store public share links as the security mechanism.

## Device and offline
- Registered device
- Device registration/replacement event
- Offline download
- Offline licence
- Licence renewal/revocation event

## Learning
- Lesson progress
- Playback position
- Quiz
- Question
- Choice
- Quiz attempt
- Assignment and submission (only if approved)
- Course completion
- Certificate

Progress and download status must be independent. Deleting a downloaded asset must not erase learning progress.

## Operations
- Notification
- Notification delivery attempt
- Audit event
- Support case (if approved)
- Content takedown record

## Key relationships

- User may have many orders.
- Order may have one or more items, subject to future bundle decision.
- Payment belongs to an order or payment attempt; provider references must be unique where appropriate.
- Verified successful payment may create an entitlement.
- Entitlement belongs to one user and one course.
- Course contains ordered modules; modules contain ordered lessons.
- Lesson may reference multiple assets.
- User has up to two active devices.
- Device may hold multiple offline downloads and licences.
- User progress is recorded against stable course/lesson version identifiers.
- Certificate references the completion rule/version used to issue it.

## Data integrity requirements

- Unique provider payment references.
- Idempotency key or unique event identity for webhook processing.
- Foreign keys and appropriate deletion restrictions.
- Transactions around payment confirmation and entitlement creation.
- Audit records for entitlement revocation, device replacement, withdrawal and administrative grants.
- Avoid cascading deletion of purchase, progress, certificate and audit history.
