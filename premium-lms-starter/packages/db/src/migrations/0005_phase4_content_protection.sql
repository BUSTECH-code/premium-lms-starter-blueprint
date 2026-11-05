-- Phase 4 — web content-protection hardening
--
-- Approved boundary: web-only, session-bound delivery grants. Native device
-- registration, offline licences and concurrent-session policy remain open.
-- A grant is still short-lived and scoped; it may be reused for HTTP Range
-- requests from the SAME authenticated session and user agent until expiry.

ALTER TABLE media_asset_grants
  ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  ADD COLUMN user_agent_hash TEXT,
  ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  ADD COLUMN last_access_at TIMESTAMPTZ;

CREATE INDEX media_asset_grants_session_idx ON media_asset_grants(session_id);

-- Newly bound grants carry both fields together; older development rows may
-- retain NULLs but are rejected by resolveMediaGrant rather than silently
-- accepted. The hash is a SHA-256 hex digest of a normalised user agent.
ALTER TABLE media_asset_grants
  ADD CONSTRAINT media_asset_grants_binding_pair
  CHECK (
    (session_id IS NULL AND user_agent_hash IS NULL)
    OR (
      session_id IS NOT NULL
      AND user_agent_hash ~ '^[0-9a-f]{64}$'
    )
  );

COMMENT ON COLUMN media_asset_grants.session_id IS
  'Authenticated session that may redeem this grant; NULL legacy rows are never redeemable.';
COMMENT ON COLUMN media_asset_grants.user_agent_hash IS
  'SHA-256 of the normalised issuing user agent; delivery must present the same agent.';
COMMENT ON COLUMN media_asset_grants.access_count IS
  'Delivery request count for audit; range requests from one session are allowed.';
COMMENT ON COLUMN media_asset_grants.last_access_at IS
  'Last successful scoped delivery authorization, using server time.';
