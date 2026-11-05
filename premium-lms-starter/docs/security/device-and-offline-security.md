# Security: Devices and Offline Access

> **Phase 4 scope note (approved 2026-11-05).** The product owner explicitly deferred mobile device registration and native offline licensing. The historical mobile baseline below is **not implemented** in Phase 4, and no concurrent-session cap was invented. Phase 4 implements browser-queue integrity and web delivery hardening only.

## Historical mobile target — deferred in Phase 4
- Maximum two active registered devices per student.
- Self-service replacement is the intended policy.
- Offline licence duration is 90 days.
- Renewal requires online authorization.
- Offline downloads are for in-app playback, not ordinary exported MP4 files.

## Recommended controls
- Server-side device registration and active-device count enforcement.
- Audited device replacement events.
- Secure device-bound licence storage.
- App-private encrypted media storage.
- Integrity verification.
- Short-lived online delivery authorization.
- Watermarking and download/access logs where feasible.
- Re-check entitlement and device state on licence renewal.

## Important limitation
A device that is offline cannot receive an immediate remote revocation. Design licence validity and replacement messaging to make this limitation clear.

## Open decisions
- Device identity and device reset/reinstall behaviour.
- Repeated replacement cooldown or abuse policy.
- Whether old offline content remains playable until its existing licence expires.
- Offline expiry behaviour when there is no network.
- Rooted/jailbroken device policy.
- Supported mobile platforms and secure playback technology.

## Phase 4 web implementation

- Short-lived, session/user-agent-bound media grants and signed URLs.
- Anti-hotlink origin/referrer checks, no-store headers, audit events and media rate limits.
- Visible session watermark in the web player (email, short session reference, timestamp).
- Checksummed browser offline progress queue with quarantine for tampered or terminal-rejected batches.
- Server-side batch checksum validation and strict event-sequence validation.

Native device identity, replacement cooldowns, 90-day licences, app-private encrypted media, offline playback renewal and rooted-device policy remain **Open/deferred**. Browser localStorage is integrity-checked but is not a trusted licence store.
