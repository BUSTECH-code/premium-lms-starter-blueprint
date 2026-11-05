import { createHash, randomBytes } from 'node:crypto';
import type { DbClient } from '../client.js';
import type { MediaAssetRow } from '../types.js';
import { LearningError } from './learning-errors.js';

/**
 * Short-lived, session-bound scoped grants: 5 minutes, re-checked against
 * entitlement + sequential unlock on every delivery. Range requests from the
 * same authenticated session and user agent may reuse a grant until expiry.
 */
export const MEDIA_GRANT_TTL_SECONDS = 300;

export interface MediaAssetPublic {
  id: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

export interface MediaGrantView {
  token: string;
  expiresAt: string;
  purpose: 'stream' | 'download';
  asset: MediaAssetPublic;
  /** Internal only — never serialized into a client response. */
  grantId: string;
  sessionId: string;
  userAgentHash: string;
}

export interface LessonMediaAsset {
  assetId: string;
  row: MediaAssetRow;
  public: MediaAssetPublic;
}

export interface ResolvedMediaGrant {
  lessonId: string;
  courseSlug: string;
  purpose: 'stream' | 'download';
  expiresAt: Date | string;
  asset: MediaAssetRow;
  grantId: string;
  /** 1 on the first successful resolution; used to audit one access per grant. */
  accessCount: number;
}

export interface MediaGrantContext {
  sessionId: string;
  userAgent: string | null | undefined;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashMediaGrantToken(token: string): string {
  return sha256Hex(token);
}

export function normaliseUserAgent(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Opaque binding hash; no raw user-agent string is stored. */
export function hashMediaUserAgent(value: string | null | undefined): string {
  return sha256Hex(`lms.media.user-agent.v1\u001f${normaliseUserAgent(value)}`);
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return new Date().toISOString();
}

function toPublicAsset(row: MediaAssetRow): MediaAssetPublic {
  return {
    id: row.id,
    mimeType: row.mime_type,
    fileName: row.file_name,
    sizeBytes: Number(row.file_size_bytes),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
  };
}

const MEDIA_ASSET_COLUMNS = `
  ma.id, ma.provider, ma.provider_reference, ma.mime_type, ma.file_name,
  ma.file_size_bytes::text AS file_size_bytes, ma.checksum_sha256,
  ma.duration_seconds::text AS duration_seconds, ma.version,
  ma.created_at, ma.updated_at`;

/** The private asset attached to a lesson (server-side only). */
export async function getLessonMediaAsset(
  db: DbClient,
  lessonId: string,
): Promise<LessonMediaAsset | null> {
  const { rows } = await db.query<MediaAssetRow>(
    `SELECT ${MEDIA_ASSET_COLUMNS}
       FROM lesson_content lc
       JOIN media_assets ma ON ma.id = lc.asset_id
      WHERE lc.lesson_id = $1`,
    [lessonId],
  );
  const row = rows[0];
  if (!row) return null;
  return { assetId: row.id, row, public: toPublicAsset(row) };
}

export async function createMediaGrant(
  db: DbClient,
  input: {
    userId: string;
    lessonId: string;
    purpose: 'stream' | 'download';
    context: MediaGrantContext;
  },
): Promise<MediaGrantView> {
  const { rows: lessonRows } = await db.query<{ kind: string; asset_id: string | null }>(
    `SELECT l.kind, lc.asset_id
       FROM lessons l
       LEFT JOIN lesson_content lc ON lc.lesson_id = l.id
      WHERE l.id = $1`,
    [input.lessonId],
  );
  const lesson = lessonRows[0];
  if (!lesson) throw new LearningError('lesson_not_found', 'Lesson not found.');
  const allowed =
    (lesson.kind === 'video' && input.purpose === 'stream') ||
    (lesson.kind === 'download' && input.purpose === 'download');
  if (!allowed) {
    throw new LearningError(
      'unsupported_lesson_kind',
      'This lesson does not support that media request.',
    );
  }
  if (!lesson.asset_id) {
    throw new LearningError('content_not_configured', 'This lesson has no media configured.');
  }

  const asset = await getLessonMediaAsset(db, input.lessonId);
  if (!asset || asset.assetId !== lesson.asset_id) {
    throw new LearningError('content_not_configured', 'This lesson has no media configured.');
  }

  const token = randomBytes(32).toString('hex');
  const userAgentHash = hashMediaUserAgent(input.context.userAgent);
  const { rows } = await db.query<{ id: string; expires_at: Date | string }>(
    `INSERT INTO media_asset_grants
       (token_hash, user_id, lesson_id, asset_id, purpose, expires_at,
        session_id, user_agent_hash)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6), $7, $8)
     RETURNING id::text, expires_at`,
    [
      sha256Hex(token),
      input.userId,
      input.lessonId,
      asset.assetId,
      input.purpose,
      MEDIA_GRANT_TTL_SECONDS,
      input.context.sessionId,
      userAgentHash,
    ],
  );
  const inserted = rows[0];
  if (!inserted) throw new Error('Media grant insert returned no row');

  return {
    token,
    expiresAt: toIso(inserted.expires_at),
    purpose: input.purpose,
    asset: asset.public,
    grantId: inserted.id,
    sessionId: input.context.sessionId,
    userAgentHash,
  };
}

/**
 * Atomically resolve an opaque grant token for delivery. The API MUST also
 * call `getLessonContext` to re-verify entitlement and sequential unlock, and
 * verify the signed URL before calling this repository.
 */
export async function resolveMediaGrant(
  db: DbClient,
  input: {
    token: string;
    userId: string;
    sessionId: string;
    userAgent: string | null | undefined;
  },
): Promise<ResolvedMediaGrant> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<
      MediaAssetRow & {
        grant_id: string;
        lesson_id: string;
        course_slug: string;
        grant_purpose: 'stream' | 'download';
        grant_expires_at: Date | string;
        access_count: string;
      }
    >(
      `SELECT ${MEDIA_ASSET_COLUMNS},
              g.id::text AS grant_id,
              g.lesson_id::text AS lesson_id,
              c.slug AS course_slug,
              g.purpose AS grant_purpose,
              g.expires_at AS grant_expires_at,
              g.access_count::text AS access_count
         FROM media_asset_grants g
         JOIN lessons l ON l.id = g.lesson_id
         JOIN modules m ON m.id = l.module_id
         JOIN courses c ON c.id = m.course_id
         JOIN lesson_content lc ON lc.lesson_id = g.lesson_id AND lc.asset_id = g.asset_id
         JOIN media_assets ma ON ma.id = g.asset_id
        WHERE g.token_hash = $1
          AND g.user_id = $2
          AND g.session_id = $3
          AND g.user_agent_hash = $4
        FOR UPDATE OF g`,
      [
        sha256Hex(input.token),
        input.userId,
        input.sessionId,
        hashMediaUserAgent(input.userAgent),
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new LearningError('media_grant_invalid', 'This media link is not valid.');
    }
    const expires = row.grant_expires_at instanceof Date
      ? row.grant_expires_at
      : new Date(String(row.grant_expires_at));
    if (expires.getTime() <= Date.now()) {
      throw new LearningError(
        'media_grant_expired',
        'This media link has expired. Request a new one.',
      );
    }

    const accessCount = Number(row.access_count) + 1;
    await tx.query(
      `UPDATE media_asset_grants
          SET access_count = $2, last_access_at = now()
        WHERE id = $1`,
      [row.grant_id, accessCount],
    );

    const {
      grant_id: grantId,
      lesson_id: lessonId,
      course_slug: courseSlug,
      grant_purpose: purpose,
      grant_expires_at: expiresAt,
      access_count: _accessCount,
      ...asset
    } = row;
    return {
      grantId,
      lessonId,
      courseSlug,
      purpose,
      expiresAt,
      asset: asset as MediaAssetRow,
      accessCount,
    };
  });
}
