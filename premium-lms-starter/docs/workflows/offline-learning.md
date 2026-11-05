# Workflow: Protected Offline Learning

> **Phase 4 scope note (approved 2026-11-05).** The mobile licence flow below is a historical/future target. Phase 4 implements **web-only** checksummed progressive synchronization and explicitly defers native device registration and offline licensing.

## Historical mobile goal — deferred in Phase 4

Allow a learner with an active course entitlement to download approved content into the mobile app for offline playback, subject to a 90-day offline licence.

## Proposed flow

1. Learner signs in on a registered device.
2. Backend verifies user, device status, course entitlement and asset download policy.
3. Backend issues a download authorization and offline licence.
4. App downloads content into app-private storage.
5. App verifies integrity/checksum where available.
6. App stores licence metadata securely and binds authorization to the device.
7. App plays content only when licence and local integrity checks permit.
8. Before licence expiry, app requests renewal while online.
9. Backend re-checks account, entitlement, device and content policy before renewal.

## Rules

- Two active registered devices maximum.
- Offline licence target duration: 90 days.
- Course entitlement itself does not expire after 90 days.
- Renewal requires online authorization.
- Downloaded content is for in-app use, not ordinary MP4 export.
- Download state and learning progress are separate.
- Downloads should support pause/resume and clear failure recovery where technically feasible.
- Storage usage and download quality should be visible to the learner.

## Security limitations

- Encryption at rest and app-private storage reduce casual extraction but do not guarantee DRM.
- A rooted/jailbroken or compromised device may weaken protections.
- Screen recording or external capture cannot be fully prevented on all devices.
- Personalised watermarking and access logging are deterrents, not absolute prevention.
- A device offline cannot receive immediate remote revocation.
- The exact behaviour of an expired or replaced device's offline licence remains an open decision.

## Failure cases

- Network loss during download.
- App termination during download.
- Insufficient storage.
- File integrity mismatch.
- Device replacement while old device is offline.
- Course entitlement revoked while device is offline.
- Licence expires with no connectivity.
- Google Drive or storage provider unavailable.
- User reinstalls app or loses local encryption key.
- User changes device clock; use trusted time/secure licence design rather than trusting local wall clock alone.

## Open decisions

- Supported download content types.
- Android/iOS target.
- Quality selection and maximum storage.
- Offline expiry behaviour.
- Device identity and replacement abuse policy.
- Offline assessments and synchronization.

## Phase 4 web implementation

- Offline progress events are queued in browser localStorage with a SHA-256 queue checksum, per-lesson monotonic sequences and stable client event IDs.
- On reconnection, the queue drains in bounded batches; each batch carries a canonical checksum computed from the exact event payload.
- A tampered queue is rejected and quarantined rather than silently replayed. Terminal 4xx responses are quarantined to avoid infinite retries.
- The API independently validates the checksum, client ID, event IDs, ascending sequences, occurred-at timestamps and progress bounds before writing.
- Exact-once replay and stale/duplicate handling remain server-authoritative; the browser checksum is an integrity/tamper check, not a trust grant.

No native offline playback, 90-day licence, device registration, download quality/storage policy or offline quiz behaviour was implemented. Those decisions remain Open/deferred.
