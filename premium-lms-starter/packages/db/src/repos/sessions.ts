import type { DbClient } from '../client.js';
import type { SessionRow } from '../types.js';

const SESSION_COLUMNS = `id, user_id, refresh_token_hash, previous_refresh_token_hash,
  created_at, expires_at, rotated_at, revoked_at, revoked_reason, last_seen_at,
  user_agent, ip_address`;

export type SessionRevocationReason = 'logout' | 'reuse_detected' | 'admin_revoked';

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function createSession(db: DbClient, input: CreateSessionInput): Promise<SessionRow> {
  const { rows } = await db.query<SessionRow>(
    `INSERT INTO sessions (user_id, refresh_token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SESSION_COLUMNS}`,
    [
      input.userId,
      input.refreshTokenHash,
      input.expiresAt,
      input.userAgent ?? null,
      input.ipAddress ?? null,
    ],
  );
  const session = rows[0];
  if (!session) throw new Error('Session insert returned no row');
  return session;
}

export async function findSessionById(db: DbClient, id: string): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findSessionByRefreshHash(
  db: DbClient,
  refreshTokenHash: string,
): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE refresh_token_hash = $1`,
    [refreshTokenHash],
  );
  return rows[0] ?? null;
}

export async function findSessionByPreviousRefreshHash(
  db: DbClient,
  refreshTokenHash: string,
): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE previous_refresh_token_hash = $1`,
    [refreshTokenHash],
  );
  return rows[0] ?? null;
}

/**
 * Rotate the refresh token: the presented (current) hash moves to
 * `previous_refresh_token_hash` and the new hash becomes current.
 * Optimistic concurrency: rotation only succeeds if the stored hash still
 * matches what the caller presented.
 */
export async function rotateSession(
  db: DbClient,
  input: { sessionId: string; currentHash: string; newHash: string },
): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `UPDATE sessions
        SET refresh_token_hash = $3,
            previous_refresh_token_hash = $2,
            rotated_at = now(),
            last_seen_at = now()
      WHERE id = $1
        AND refresh_token_hash = $2
        AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING ${SESSION_COLUMNS}`,
    [input.sessionId, input.currentHash, input.newHash],
  );
  return rows[0] ?? null;
}

export async function revokeSession(
  db: DbClient,
  input: { sessionId: string; reason: SessionRevocationReason },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [input.sessionId, input.reason],
  );
  return rowCount > 0;
}

/** Update `last_seen_at` when a session is actively used (refresh time). */
export async function touchSession(db: DbClient, sessionId: string): Promise<void> {
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [sessionId]);
}
