# Security: Content Protection

> **Phase 4 scope note (approved 2026-11-05).** Implementation is **web-only hardening**. Native device registration, native offline licensing and a concurrent-session cap are deferred; no 2-session cap was invented. The historical mobile controls below remain future-work targets, not Phase 4 acceptance criteria.

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
- Browser queue integrity checks; native app-private protected offline storage remains deferred.
- Native device limits remain deferred in Phase 4.
- Visible web session watermark, as a deterrent only.
- Download, grant and denial audit events.
- Time-bounded native offline licences remain deferred in Phase 4.

This reduces casual sharing and raises the effort required to copy content. It does not guarantee prevention of screen recording, camera capture, rooted-device extraction or all piracy.

## Google Drive limitation

Google Drive is the initial private repository, not an assumed production CDN. Validate quotas, throughput, transfer limits, playback compatibility and concurrent access. If it cannot meet requirements, select a suitable delivery provider behind the storage abstraction.

## Phase 4 web implementation status

- `0005_phase4_content_protection.sql` adds session/user-agent binding, access counters and last-access timestamps to media grants; applied-migration checksums and tamper detection are tested.
- `packages/shared` provides a canonical progress-batch checksum; `@lms/shared` is a pure integrity utility, not a browser trust boundary.
- Media grants are short-lived (300 seconds), scoped to one lesson/purpose, bound to the issuing session/user agent and resolved atomically. The API re-checks entitlement and sequential lesson unlock on every byte request.
- HMAC-signed URLs bind path, grant, purpose, expiry, opaque session reference and nonce. Tokens and signed URLs are never logged or written to audit metadata.
- Anti-hotlink checks reject cross-site/embedding contexts and untrusted `Origin`/`Referer` values; responses set `Cache-Control: no-store`, `Pragma: no-cache`, `X-Robots-Tag`, `Vary` and `Cross-Origin-Resource-Policy: same-site`.
- Grant issuance and content requests have independent sliding-window rate limits; denials and first deliveries are audited.
- The web player shows the signed-in email, a short opaque session reference and a timestamp. PDF/video bytes are not mutated; downloadable fixture checksums remain exact.
- Browser progressive sync uses a checksummed localStorage queue, per-lesson sequences, batch digests and a quarantine key for tampered or terminal-rejected batches. Client checks detect accidental corruption/tampering; the server remains authoritative.

This reduces casual link sharing, hotlinking and naive replay. It does **not** promise zero piracy, prevent screen recording/camera capture, or provide native DRM. Private Google Drive remains a documented provider seam; no public Drive links or client-visible credentials are exposed.
