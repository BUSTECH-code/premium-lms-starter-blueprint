# Security: Content Protection

## Storage

- Keep Google Drive files private.
- Access Drive through backend-controlled credentials and Drive API.
- Store private file IDs and metadata, not public share URLs.
- Never expose service credentials or unrestricted Drive links to the browser.
- Check user entitlement and asset policy before issuing access.
- Keep a provider abstraction for future storage/delivery changes.

## Delivery

- Authorize every media request against user, course entitlement, lesson and asset.
- Use short-lived, scoped delivery authorization where supported.
- Avoid logging access tokens or signed URLs.
- Validate content type and metadata.
- Consider range requests, streaming behaviour and bandwidth cost during provider evaluation.

## Honest protection model

The intended protection is balanced:
- Private source files.
- Backend authorization.
- Protected app-private offline storage.
- Device limits.
- Personalised watermarking where feasible.
- Download and access tracking.
- Time-bounded offline licences.

This reduces casual sharing and raises the effort required to copy content. It does not guarantee prevention of screen recording, camera capture, rooted-device extraction or all piracy.

## Google Drive limitation

Google Drive is the initial private repository, not an assumed production CDN. Validate quotas, throughput, transfer limits, playback compatibility and concurrent access. If it cannot meet requirements, select a suitable delivery provider behind the storage abstraction.
