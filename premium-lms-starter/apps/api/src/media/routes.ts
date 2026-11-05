import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getLessonContext,
  insertAuditEvent,
  LearningError,
  resolveMediaGrant,
  type DbClient,
} from '@lms/db';
import { authenticate } from '../auth/middleware.js';
import { SlidingWindowRateLimiter, rateLimit } from '../auth/rate-limit.js';
import type { Env } from '../config/env.js';
import { errors } from '../lib/errors.js';
import { toAppError } from '../learning/errors.js';
import { getValidatedQuery, validateQuery } from '../middleware/validate.js';
import { assertAllowedMediaContext, mediaResponseHeaders } from './hotlink.js';
import type { MediaProvider, MediaRange } from './provider.js';
import { verifySignedMediaUrl, type SignedMediaQuery } from './signing.js';

const mediaQuerySchema = z.object({
  grant: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid media grant.'),
  purpose: z.enum(['stream', 'download']),
  exp: z.coerce.number().int().positive(),
  sid: z.string().regex(/^[0-9a-f]{12}$/, 'Invalid session reference.'),
  nonce: z.string().regex(/^[0-9a-f]{32}$/, 'Invalid delivery nonce.'),
  sig: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid delivery signature.'),
});

interface MediaRouterDeps {
  env: Env;
  db: DbClient;
  provider: MediaProvider;
  contentLimiter: SlidingWindowRateLimiter;
}

function parseRange(
  header: string | undefined,
  size: number,
): MediaRange | 'invalid' | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';
  const start = Number(match[1]);
  const rawEnd = match[2] ?? '';
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size ||
    size <= 0
  ) {
    return 'invalid';
  }
  return { start, end: Math.min(end, size - 1) };
}

function safeFileName(name: string): string {
  return name.replace(/["\r\n]/g, '_');
}

function userAgentOf(req: Request): string | null {
  const value = req.headers['user-agent'];
  return typeof value === 'string' ? value : null;
}

/** Audit denials without ever recording the signed URL, grant token or query. */
async function auditDenied(db: DbClient, req: Request, reason: string): Promise<void> {
  await insertAuditEvent(db, {
    actorUserId: req.auth?.user.id ?? null,
    action: 'media.access_denied',
    targetType: 'media_delivery',
    targetId: null,
    metadata: { reason },
    ipAddress: req.ip ?? null,
  }).catch(() => undefined);
}

async function auditFirstDelivery(
  db: DbClient,
  req: Request,
  grant: Awaited<ReturnType<typeof resolveMediaGrant>>,
): Promise<void> {
  if (grant.accessCount !== 1) return;
  await insertAuditEvent(db, {
    actorUserId: req.auth?.user.id ?? null,
    action: 'media.content_delivered',
    targetType: 'media_asset_grant',
    targetId: grant.grantId,
    metadata: {
      lessonId: grant.lessonId,
      courseSlug: grant.courseSlug,
      purpose: grant.purpose,
      delivery: 'signed_web_url',
    },
    ipAddress: req.ip ?? null,
  }).catch(() => undefined);
}

export function createMediaRouter({ env, db, provider, contentLimiter }: MediaRouterDeps): Router {
  const router = Router();

  router.use('/media/content', (_req: Request, res: Response, next: NextFunction) => {
    mediaResponseHeaders(res);
    next();
  });

  const deliver = (headOnly: boolean) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const query = getValidatedQuery<z.infer<typeof mediaQuerySchema>>(req);

        try {
          assertAllowedMediaContext(req, env);
        } catch (error) {
          await auditDenied(db, req, 'hotlink_or_embedding');
          throw error;
        }

        const signature = verifySignedMediaUrl(
          query as SignedMediaQuery,
          env.media.signingSecret,
          auth.sessionId,
        );
        if (!signature.ok) {
          await auditDenied(db, req, signature.reason);
          throw errors.forbidden(
            signature.reason,
            signature.reason === 'media_signature_expired'
              ? 'This media link has expired. Request a new one.'
              : signature.reason === 'media_session_mismatch'
                ? 'This media link belongs to another session.'
                : 'This media link is not valid.',
          );
        }

        const resolved = await resolveMediaGrant(db, {
          token: query.grant,
          userId: auth.user.id,
          sessionId: auth.sessionId,
          userAgent: userAgentOf(req),
        });

        // Defense in depth: re-check entitlement AND sequential unlock on every
        // byte request, not only when the grant was issued.
        await getLessonContext(db, auth.user.id, resolved.lessonId);

        if (query.purpose !== resolved.purpose) {
          throw new LearningError('media_grant_invalid', 'This media link is not valid for that use.');
        }

        const size = Number(resolved.asset.file_size_bytes);
        const range = parseRange(req.headers.range, size);
        if (range === 'invalid') {
          res.setHeader('Content-Range', `bytes */${size}`);
          res.status(416).json({
            error: { code: 'invalid_range', message: 'Requested range is not satisfiable.' },
          });
          return;
        }

        const media = await provider.open(resolved.asset, range ?? undefined);
        res.status(range ? 206 : 200);
        res.setHeader('Content-Type', media.mimeType);
        res.setHeader('Content-Length', String(media.contentLength));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader(
          'Content-Disposition',
          `${query.purpose === 'download' ? 'attachment' : 'inline'}; filename="${safeFileName(media.fileName)}"`,
        );
        if (range) {
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${media.sizeBytes}`);
        }

        await auditFirstDelivery(db, req, resolved);

        if (headOnly) {
          media.stream.destroy();
          res.end();
          return;
        }

        media.stream.on('error', (error: unknown) => {
          if (!res.headersSent) {
            next(toAppError(error));
          } else {
            res.destroy(error instanceof Error ? error : undefined);
          }
        });
        media.stream.pipe(res);
      } catch (error) {
        next(toAppError(error));
      }
    };

  router.get(
    '/media/content',
    authenticate(env, db),
    rateLimit({
      limiter: contentLimiter,
      keyOf: (req) =>
        `media-content:${req.auth?.user.id ?? 'anonymous'}:${req.auth?.sessionId ?? 'anonymous'}`,
      message: 'Too many media requests. Please try again shortly.',
    }),
    validateQuery(mediaQuerySchema),
    deliver(false),
  );
  router.head(
    '/media/content',
    authenticate(env, db),
    rateLimit({
      limiter: contentLimiter,
      keyOf: (req) =>
        `media-content:${req.auth?.user.id ?? 'anonymous'}:${req.auth?.sessionId ?? 'anonymous'}`,
      message: 'Too many media requests. Please try again shortly.',
    }),
    validateQuery(mediaQuerySchema),
    deliver(true),
  );

  return router;
}
