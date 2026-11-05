import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getLessonContext,
  LearningError,
  resolveMediaGrant,
  type DbClient,
} from '@lms/db';
import { authenticate } from '../auth/middleware.js';
import type { Env } from '../config/env.js';
import { errors } from '../lib/errors.js';
import { toAppError } from '../learning/errors.js';
import { getValidatedQuery, validateQuery } from '../middleware/validate.js';
import type { MediaProvider, MediaRange } from './provider.js';

const mediaQuerySchema = z.object({
  grant: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid media grant.'),
  download: z.literal('1').optional(),
});

interface MediaRouterDeps {
  env: Env;
  db: DbClient;
  provider: MediaProvider;
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

export function createMediaRouter({ env, db, provider }: MediaRouterDeps): Router {
  const router = Router();

  const deliver = (headOnly: boolean) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const query = getValidatedQuery<z.infer<typeof mediaQuerySchema>>(req);
        const resolved = await resolveMediaGrant(db, query.grant, auth.user.id);

        // Defense in depth: re-check entitlement AND sequential unlock on every
        // byte request, not only when the grant was issued.
        await getLessonContext(db, auth.user.id, resolved.lessonId);

        const wantsDownload = query.download === '1';
        const purposeMatches = wantsDownload
          ? resolved.purpose === 'download'
          : resolved.purpose === 'stream';
        if (!purposeMatches) {
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
          `${wantsDownload ? 'attachment' : 'inline'}; filename="${safeFileName(media.fileName)}"`,
        );
        if (range) {
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${media.sizeBytes}`);
        }

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
    validateQuery(mediaQuerySchema),
    deliver(false),
  );
  router.head(
    '/media/content',
    authenticate(env, db),
    validateQuery(mediaQuerySchema),
    deliver(true),
  );

  return router;
}
