# Security: Devices and Offline Access

## Confirmed baseline
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
