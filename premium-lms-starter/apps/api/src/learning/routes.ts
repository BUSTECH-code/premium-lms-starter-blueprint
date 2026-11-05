import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { progressBatchChecksum } from '@lms/shared';
import {
  createMediaGrant,
  getCoursePlayerState,
  getGradebookView,
  getLearningCourseContext,
  getLessonContext,
  getLessonDetail,
  insertAuditEvent,
  readCourseCompletionView,
  recordProgressEvent,
  submitQuizAttempt,
  type DbClient,
  type MediaGrantView,
} from '@lms/db';
import { authenticate } from '../auth/middleware.js';
import type { AuthContext } from '../auth/context.js';
import type { Env } from '../config/env.js';
import { SlidingWindowRateLimiter, rateLimit } from '../auth/rate-limit.js';
import { AppError, errors } from '../lib/errors.js';
import { buildViewerWatermark, type ViewerWatermark } from '../media/watermark.js';
import { buildSignedMediaUrl } from '../media/signing.js';
import { toAppError } from './errors.js';
import {
  getValidatedParams,
  validateBody,
  validateParams,
} from '../middleware/validate.js';

const slugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Invalid course slug.')
    .min(2)
    .max(80),
});

const lessonParamsSchema = z.object({
  lessonId: z.uuid('A valid lesson id is required.'),
});

const clientIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Invalid progress client id.');

const progressEventSchema = z.object({
  clientEventId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Invalid client event id.'),
  sequence: z.number().int().min(1).max(1_000_000),
  type: z.enum(['start', 'position', 'complete']),
  occurredAt: z
    .string()
    .min(1)
    .max(40)
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'Invalid event timestamp.')
    .refine((value) => Date.parse(value) <= Date.now() + 300_000, 'Event timestamp cannot be in the future.'),
  progressPercent: z.number().min(0).max(100).refine(Number.isFinite, 'Invalid progress percent.').optional(),
  positionSeconds: z.number().min(0).refine(Number.isFinite, 'Invalid playback position.').optional(),
});

const progressBatchSchema = z.object({
  clientId: clientIdSchema,
  events: z
    .array(progressEventSchema)
    .min(1)
    .max(50)
    .refine((events) => {
      const ids = new Set<string>();
      let previous = 0;
      for (const event of events) {
        if (event.sequence <= previous || ids.has(event.clientEventId)) return false;
        previous = event.sequence;
        ids.add(event.clientEventId);
      }
      return true;
    }, 'Events must have unique ids and strictly ascending sequences.'),
  checksum: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid progress batch checksum.'),
});

const quizAttemptSchema = z.object({
  clientSubmissionId: z.string().trim().min(1).max(120),
  answers: z
    .record(z.string().min(1).max(120), z.array(z.string().min(1).max(80)).max(20))
    .refine((answers) => Object.keys(answers).length <= 50, 'Too many answers.'),
});

const mediaBodySchema = z.object({
  purpose: z.enum(['stream', 'download']),
});

type PlayerState = Awaited<ReturnType<typeof getCoursePlayerState>>;
type LessonDetail = Awaited<ReturnType<typeof getLessonDetail>>;

interface LearningRouterDeps {
  env: Env;
  db: DbClient;
  mediaGrantLimiter: SlidingWindowRateLimiter;
}

function safeDigestEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

function userAgentOf(req: Request): string | null {
  const value = req.headers['user-agent'];
  return typeof value === 'string' ? value : null;
}

function serializeMediaGrant(media: MediaGrantView, signingSecret: string) {
  // Only the signed, short-lived URL and public asset metadata leave the API.
  // Provider references, token internals and raw session IDs are never exposed.
  const url = buildSignedMediaUrl({
    token: media.token,
    purpose: media.purpose,
    expiresAt: media.expiresAt,
    sessionId: media.sessionId,
    signingSecret,
  });
  return {
    url,
    expiresAt: media.expiresAt,
    purpose: media.purpose,
    mimeType: media.asset.mimeType,
    fileName: media.asset.fileName,
    sizeBytes: media.asset.sizeBytes,
    durationSeconds: media.asset.durationSeconds,
  };
}

function serializePlayerState(state: PlayerState, viewer: ViewerWatermark) {
  const slug = state.course.slug;
  return {
    course: { ...state.course, href: `/learn/${slug}` },
    viewer,
    criteriaVersion: state.criteriaVersion,
    criteria: state.criteria,
    progressPercent: state.progressPercent,
    completion: state.completion,
    gradebook: state.gradebook,
    suggestedLessonId: state.suggestedLessonId,
    lessons: state.lessons.map((lesson) => ({
      ...lesson,
      href: `/learn/${slug}/${lesson.id}`,
    })),
  };
}

function serializeLessonDetail(
  detail: LessonDetail,
  viewer: ViewerWatermark,
  signingSecret: string,
) {
  const slug = detail.course.slug;
  const quizContent = detail.content as Extract<LessonDetail['content'], { kind: 'quiz' }>;
  const content =
    detail.content.kind === 'video' || detail.content.kind === 'download'
      ? {
          kind: detail.content.kind,
          media: serializeMediaGrant(detail.content.media, signingSecret),
        }
      : detail.content.kind === 'text'
        ? { kind: 'text' as const, bodyText: detail.content.bodyText }
        : { kind: 'quiz' as const, quiz: quizContent.quiz };

  return {
    lesson: { ...detail.lesson, href: `/learn/${slug}/${detail.lesson.id}` },
    course: { ...detail.course, href: `/learn/${slug}` },
    viewer,
    criteriaVersion: detail.criteriaVersion,
    progress: detail.progress,
    completion: detail.completion,
    gradebook: detail.gradebook,
    content,
    nextLessonId: detail.nextLessonId,
    previousLessonId: detail.previousLessonId,
    nextLessonHref: detail.nextLessonId ? `/learn/${slug}/${detail.nextLessonId}` : null,
    previousLessonHref: detail.previousLessonId
      ? `/learn/${slug}/${detail.previousLessonId}`
      : null,
  };
}

async function auditMediaGrant(
  db: DbClient,
  req: Request,
  auth: AuthContext,
  media: MediaGrantView,
  lessonId: string,
): Promise<void> {
  await insertAuditEvent(db, {
    actorUserId: auth.user.id,
    action: 'media.grant_issued',
    targetType: 'media_asset_grant',
    targetId: media.grantId,
    metadata: {
      lessonId,
      purpose: media.purpose,
      expiresAt: media.expiresAt,
      delivery: 'signed_web_url',
    },
    ipAddress: req.ip ?? null,
  });
}

export function createLearningRouter({ env, db, mediaGrantLimiter }: LearningRouterDeps): Router {
  const router = Router();

  // --------------------------------------------------------------------------
  // GET /api/learning/courses/:slug — full player bootstrap (server-authoritative)
  // --------------------------------------------------------------------------
  router.get(
    '/learning/courses/:slug',
    authenticate(env, db),
    validateParams(slugParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { slug } = getValidatedParams<z.infer<typeof slugParamsSchema>>(req);
        const state = await getCoursePlayerState(db, auth.user.id, slug);
        const viewer = buildViewerWatermark(auth, env.media.signingSecret);
        res.json(serializePlayerState(state, viewer));
      } catch (error) {
        next(toAppError(error));
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/learning/courses/:slug/gradebook — overall course gradebook
  // --------------------------------------------------------------------------
  router.get(
    '/learning/courses/:slug/gradebook',
    authenticate(env, db),
    validateParams(slugParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { slug } = getValidatedParams<z.infer<typeof slugParamsSchema>>(req);
        const context = await getLearningCourseContext(db, auth.user.id, slug);
        const gradebook = await getGradebookView(db, auth.user.id, context.courseId);
        const completion = await readCourseCompletionView(
          db,
          auth.user.id,
          context.courseId,
          context.criteriaVersion,
        );
        res.json({ gradebook, completion, criteriaVersion: context.criteriaVersion });
      } catch (error) {
        next(toAppError(error));
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/learning/lessons/:lessonId — authorised lesson content
  // --------------------------------------------------------------------------
  router.get(
    '/learning/lessons/:lessonId',
    authenticate(env, db),
    validateParams(lessonParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { lessonId } = getValidatedParams<z.infer<typeof lessonParamsSchema>>(req);
        const detail = await getLessonDetail(db, auth.user.id, lessonId, {
          sessionId: auth.sessionId,
          userAgent: userAgentOf(req),
        });
        if (detail.content.kind === 'video' || detail.content.kind === 'download') {
          await auditMediaGrant(db, req, auth, detail.content.media, detail.lesson.id);
        }
        const viewer = buildViewerWatermark(auth, env.media.signingSecret);
        res.json(serializeLessonDetail(detail, viewer, env.media.signingSecret));
      } catch (error) {
        next(toAppError(error));
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/learning/lessons/:lessonId/progress/events — offline-safe batch
  // --------------------------------------------------------------------------
  router.post(
    '/learning/lessons/:lessonId/progress/events',
    authenticate(env, db),
    validateParams(lessonParamsSchema),
    validateBody(progressBatchSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { lessonId } = getValidatedParams<z.infer<typeof lessonParamsSchema>>(req);
        const body = req.body as z.infer<typeof progressBatchSchema>;

        // Integrity check before any writes. This is not a browser-trust proof:
        // server-side entitlement, unlock, sequences and reducer rules follow.
        const expected = progressBatchChecksum({
          clientId: body.clientId,
          events: body.events,
        });
        if (!safeDigestEqual(body.checksum, expected)) {
          await insertAuditEvent(db, {
            actorUserId: auth.user.id,
            action: 'progress.batch_rejected',
            targetType: 'lesson',
            targetId: lessonId,
            metadata: { reason: 'integrity_digest_mismatch', clientId: body.clientId },
            ipAddress: req.ip ?? null,
          });
          throw new AppError(
            400,
            'progress_checksum_invalid',
            'The progress batch could not be verified. Please try again.',
          );
        }

        const context = await getLessonContext(db, auth.user.id, lessonId);

        if (
          context.lesson.kind === 'quiz' &&
          body.events.some((event) => event.type === 'complete')
        ) {
          throw new AppError(
            400,
            'quiz_completion_requires_pass',
            'A quiz is completed by passing it, not by marking it complete.',
          );
        }

        const results = [];
        for (const event of body.events) {
          const result = await recordProgressEvent(db, {
            userId: auth.user.id,
            courseId: context.context.courseId,
            lessonId,
            enrollmentId: context.context.enrollmentId,
            criteriaVersion: context.context.criteriaVersion,
            clientId: body.clientId,
            clientEventId: event.clientEventId,
            sequence: event.sequence,
            eventType: event.type,
            occurredAt: event.occurredAt,
            progressPercent: event.progressPercent,
            positionSeconds: event.positionSeconds,
          });
          results.push(result);
        }
        const last = results[results.length - 1];
        res.json({
          lessonId,
          results: results.map((result) => ({
            clientEventId: result.clientEventId,
            outcome: result.outcome,
            reason: result.reason ?? null,
            state: result.state,
          })),
          progress: last?.state ?? null,
          courseCompletion: last?.courseCompletion ?? null,
        });
      } catch (error) {
        next(toAppError(error));
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/learning/lessons/:lessonId/quiz/attempts — auto-graded submission
  // --------------------------------------------------------------------------
  router.post(
    '/learning/lessons/:lessonId/quiz/attempts',
    authenticate(env, db),
    validateParams(lessonParamsSchema),
    validateBody(quizAttemptSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { lessonId } = getValidatedParams<z.infer<typeof lessonParamsSchema>>(req);
        const body = req.body as z.infer<typeof quizAttemptSchema>;
        const result = await submitQuizAttempt(db, {
          userId: auth.user.id,
          lessonId,
          clientSubmissionId: body.clientSubmissionId,
          answers: body.answers,
        });
        res.status(result.outcome === 'duplicate' ? 200 : 201).json({
          outcome: result.outcome,
          attempt: result.attempt,
          lessonProgress: result.lessonProgress,
          gradebook: result.gradebook,
          courseCompletion: result.courseCompletion,
          courseSlug: result.courseSlug,
          nextLessonId: result.nextLessonId,
          nextLessonHref: result.nextLessonId
            ? `/learn/${result.courseSlug}/${result.nextLessonId}`
            : null,
        });
      } catch (error) {
        next(toAppError(error));
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/learning/lessons/:lessonId/media — refresh a signed delivery grant
  // --------------------------------------------------------------------------
  router.post(
    '/learning/lessons/:lessonId/media',
    authenticate(env, db),
    rateLimit({
      limiter: mediaGrantLimiter,
      keyOf: (req) => `media-grant:${req.auth?.user.id ?? 'anonymous'}:${req.params.lessonId ?? ''}`,
      message: 'Too many secure media requests. Please try again shortly.',
    }),
    validateParams(lessonParamsSchema),
    validateBody(mediaBodySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.auth;
        if (!auth) throw errors.unauthorized();
        const { lessonId } = getValidatedParams<z.infer<typeof lessonParamsSchema>>(req);
        const body = req.body as z.infer<typeof mediaBodySchema>;
        await getLessonContext(db, auth.user.id, lessonId);
        const media = await createMediaGrant(db, {
          userId: auth.user.id,
          lessonId,
          purpose: body.purpose,
          context: { sessionId: auth.sessionId, userAgent: userAgentOf(req) },
        });
        await auditMediaGrant(db, req, auth, media, lessonId);
        res.json({ media: serializeMediaGrant(media, env.media.signingSecret) });
      } catch (error) {
        next(toAppError(error));
      }
    },
  );

  return router;
}
