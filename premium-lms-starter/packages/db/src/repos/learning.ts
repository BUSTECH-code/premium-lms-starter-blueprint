import type { DbClient } from '../client.js';
import {
  classifyEventSequence,
  courseProgressPercent,
  emptyProgressSnapshot,
  firstIncompleteLessonId,
  isSequentialLessonUnlocked,
  nextLessonId,
  previousLessonId,
  reduceLessonProgress,
  type LessonProgressStatus,
  type LessonProgressSnapshot,
  type ProgressEventType,
  type ProgressOutcome,
  type LessonStatusMap,
  type OrderedLesson,
  type LessonKind,
} from '../domain/index.js';
import {
  toPublicQuestions,
  type GradableQuestion,
  type PublicQuizQuestion,
  type QuizChoice,
  type QuizQuestionKind,
} from '../domain/quiz-grading.js';
import { insertAuditEvent } from './audit.js';
import { LearningError, type LearningErrorCode } from './learning-errors.js';
import {
  createMediaGrant,
  getLessonMediaAsset,
  type MediaGrantView,
} from './media.js';

/** Small JSON / numeric helpers shared by learning repositories. */
export function parseJsonValue<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseJsonValue<unknown>(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function numberFrom(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export type CompletionState =
  | 'not_eligible'
  | 'in_progress'
  | 'completed'
  | 'certificate_issued';

export interface CourseCriteria {
  version: number;
  policy: 'all_required_lessons';
  lessonOrder: 'module_position_then_lesson_position';
  videoCompletion: 'explicit';
  quizPassingScorePercent: number;
}

function parseCriteria(value: unknown, version: number): CourseCriteria {
  const raw = parseJsonObject(value);
  const passing = Number(raw.quizPassingScorePercent);
  if (
    raw.policy !== 'all_required_lessons' ||
    raw.lessonOrder !== 'module_position_then_lesson_position' ||
    raw.videoCompletion !== 'explicit' ||
    !Number.isInteger(passing) ||
    passing < 1 ||
    passing > 100
  ) {
    throw new Error('Course completion criteria are invalid');
  }
  return {
    version,
    policy: 'all_required_lessons',
    lessonOrder: 'module_position_then_lesson_position',
    videoCompletion: 'explicit',
    quizPassingScorePercent: passing,
  };
}

export interface LearningCourseContext {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseStatus: string;
  courseSummary: string | null;
  enrollmentId: string;
  enrollmentStatus: string;
  criteriaVersion: number;
  criteria: CourseCriteria;
  entitlementStatus: string;
}

interface CourseContextRow {
  course_id: string;
  slug: string;
  title: string;
  status: string;
  summary: string | null;
  enrollment_id: string | null;
  enrollment_status: string | null;
  criteria_version: number | null;
  entitlement_status: string | null;
  criteria_json: string | null;
}

/** Entitlement is the authority for access; enrolment carries the frozen rules. */
export async function getLearningCourseContext(
  db: DbClient,
  userId: string,
  courseSlug: string,
): Promise<LearningCourseContext> {
  const { rows } = await db.query<CourseContextRow>(
    `SELECT c.id::text AS course_id, c.slug, c.title, c.status, c.summary,
            e.id::text AS enrollment_id, e.status AS enrollment_status,
            e.criteria_version, ent.status AS entitlement_status,
            r.criteria::text AS criteria_json
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $2
       LEFT JOIN entitlements ent ON ent.course_id = c.id AND ent.user_id = $2
       LEFT JOIN course_completion_rules r
              ON r.course_id = c.id AND r.version = e.criteria_version
      WHERE c.slug = $1`,
    [courseSlug, userId],
  );
  const row = rows[0];
  if (!row) throw new LearningError('course_not_found', 'Course not found.');

  const entitled = row.entitlement_status === 'active';
  if (!entitled) {
    // Non-published courses are invisible to non-entitled learners (no leak).
    if (row.status !== 'published') {
      throw new LearningError('course_not_found', 'Course not found.');
    }
    if (row.entitlement_status === 'revoked') {
      throw new LearningError('entitlement_revoked', 'Your access to this course was revoked.');
    }
    throw new LearningError('not_entitled', 'You do not have access to this course.');
  }
  if (!row.enrollment_id || row.criteria_version === null || !row.criteria_json) {
    throw new LearningError('not_enrolled', 'You are not enrolled in this course.');
  }

  return {
    courseId: row.course_id,
    courseSlug: row.slug,
    courseTitle: row.title,
    courseStatus: row.status,
    courseSummary: row.summary,
    enrollmentId: row.enrollment_id,
    enrollmentStatus: row.enrollment_status ?? 'active',
    criteriaVersion: Number(row.criteria_version),
    criteria: parseCriteria(row.criteria_json, Number(row.criteria_version)),
    entitlementStatus: row.entitlement_status ?? 'active',
  };
}

interface OrderedLessonRow {
  id: string;
  title: string;
  kind: LessonKind;
  module_id: string;
  module_title: string;
  module_position: number;
  lesson_position: number;
  duration_seconds: string | null;
}

export async function listOrderedLessons(
  db: DbClient,
  courseId: string,
): Promise<OrderedLesson[]> {
  const { rows } = await db.query<OrderedLessonRow>(
    `SELECT l.id::text, l.title, l.kind,
            m.id::text AS module_id, m.title AS module_title,
            m.position AS module_position, l.position AS lesson_position,
            l.duration_seconds::text AS duration_seconds
       FROM lessons l JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1
      ORDER BY m.position, l.position`,
    [courseId],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    moduleId: row.module_id,
    moduleTitle: row.module_title,
    modulePosition: Number(row.module_position),
    lessonPosition: Number(row.lesson_position),
    durationSeconds: row.duration_seconds,
  }));
}

interface LessonProgressDbRow {
  lesson_id: string;
  status: LessonProgressStatus;
  progress_percent: string;
  playback_position_seconds: string | null;
  completed_at: Date | string | null;
  completion_source: 'explicit' | 'quiz_pass' | null;
  revision: number;
  last_event_at: Date | string | null;
}

const PROGRESS_COLUMNS = `
  lesson_id::text, status, progress_percent::text AS progress_percent,
  playback_position_seconds::text AS playback_position_seconds,
  completed_at, completion_source, revision, last_event_at`;

function toSnapshot(row: LessonProgressDbRow): LessonProgressSnapshot {
  return {
    status: row.status,
    progressPercent: numberFrom(row.progress_percent),
    playbackPositionSeconds:
      row.playback_position_seconds === null
        ? null
        : numberFrom(row.playback_position_seconds),
    completedAt: toIso(row.completed_at),
    completionSource: row.completion_source,
    revision: Number(row.revision),
    lastEventAt: toIso(row.last_event_at),
  };
}

function toStatusMap(progress: ProgressByLesson): LessonStatusMap {
  const statuses: LessonStatusMap = {};
  for (const [lessonId, snapshot] of Object.entries(progress)) {
    statuses[lessonId] = snapshot.status;
  }
  return statuses;
}

export type ProgressByLesson = Record<string, LessonProgressSnapshot>;

export async function getProgressMap(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<ProgressByLesson> {
  const { rows } = await db.query<LessonProgressDbRow>(
    `SELECT ${PROGRESS_COLUMNS}
       FROM lesson_progress lp
       JOIN lessons l ON l.id = lp.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE lp.user_id = $1 AND m.course_id = $2`,
    [userId, courseId],
  );
  const progress: ProgressByLesson = {};
  for (const row of rows) progress[row.lesson_id] = toSnapshot(row);
  return progress;
}

export async function getLessonProgressSnapshot(
  db: DbClient,
  userId: string,
  lessonId: string,
): Promise<LessonProgressSnapshot> {
  const { rows } = await db.query<LessonProgressDbRow>(
    `SELECT ${PROGRESS_COLUMNS} FROM lesson_progress
      WHERE user_id = $1 AND lesson_id = $2`,
    [userId, lessonId],
  );
  const row = rows[0];
  return row ? toSnapshot(row) : emptyProgressSnapshot();
}

export interface LessonContext {
  lesson: OrderedLesson & { courseId: string; courseSlug: string };
  context: LearningCourseContext;
  lessons: OrderedLesson[];
  progress: ProgressByLesson;
  unlock: { locked: false } | { locked: true; requiresLessonId?: string; requiresLessonTitle?: string };
}

interface LessonContextRow {
  id: string;
  title: string;
  kind: LessonKind;
  position: number;
  duration_seconds: string | null;
  module_id: string;
  module_title: string;
  module_position: number;
  course_id: string;
  course_slug: string;
}

/** Server-side access check: enrolment, entitlement AND sequential unlock. */
export async function getLessonContext(
  db: DbClient,
  userId: string,
  lessonId: string,
): Promise<LessonContext> {
  const { rows } = await db.query<LessonContextRow>(
    `SELECT l.id::text, l.title, l.kind, l.position,
            l.duration_seconds::text AS duration_seconds,
            m.id::text AS module_id, m.title AS module_title,
            m.position AS module_position,
            m.course_id::text AS course_id, c.slug AS course_slug
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
      WHERE l.id = $1`,
    [lessonId],
  );
  const row = rows[0];
  if (!row) throw new LearningError('lesson_not_found', 'Lesson not found.');

  const context = await getLearningCourseContext(db, userId, row.course_slug);
  const lessons = await listOrderedLessons(db, context.courseId);
  const progress = await getProgressMap(db, userId, context.courseId);
  const unlock = isSequentialLessonUnlocked(lessons, toStatusMap(progress), lessonId);
  if (unlock.locked) {
    const code: LearningErrorCode = 'lesson_locked';
    throw new LearningError(
      code,
      unlock.requiresLessonTitle
        ? `Complete “${unlock.requiresLessonTitle}” before opening this lesson.`
        : 'This lesson is not available yet.',
      {
        requiresLessonId: unlock.requiresLessonId ?? null,
        requiresLessonTitle: unlock.requiresLessonTitle ?? null,
      },
    );
  }

  const lesson: OrderedLesson & { courseId: string; courseSlug: string } = {
    id: row.id,
    title: row.title,
    kind: row.kind,
    moduleId: row.module_id,
    moduleTitle: row.module_title,
    modulePosition: Number(row.module_position),
    lessonPosition: Number(row.position),
    durationSeconds: row.duration_seconds,
    courseId: row.course_id,
    courseSlug: row.course_slug,
  };
  return { lesson, context, lessons, progress, unlock: { locked: false } };
}

export interface CourseCompletionView {
  status: CompletionState;
  criteriaVersion: number;
  completedAt: string | null;
  progressPercent: number;
}

export async function readCourseCompletionView(
  db: DbClient,
  userId: string,
  courseId: string,
  criteriaVersion: number,
): Promise<CourseCompletionView> {
  const lessons = await listOrderedLessons(db, courseId);
  const progress = await getProgressMap(db, userId, courseId);
  const { rows } = await db.query<{
    status: CompletionState;
    completed_at: Date | string | null;
  }>(
    `SELECT status, completed_at FROM course_completion
      WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId],
  );
  const row = rows[0];
  return {
    status: row?.status ?? 'in_progress',
    criteriaVersion,
    completedAt: toIso(row?.completed_at ?? null),
    progressPercent: courseProgressPercent(lessons, toStatusMap(progress)),
  };
}

/**
 * Evaluate the frozen course criteria after any progress/assessment change.
 * `completed` is never revoked; certificates are deliberately not issued (Q4).
 * Called INSIDE an existing transaction — never starts a nested one.
 */
export async function evaluateCourseCompletionInTransaction(
  tx: DbClient,
  input: { userId: string; courseId: string; criteriaVersion: number },
): Promise<CourseCompletionView> {
  const { rows: ruleRows } = await tx.query<{ criteria_json: string }>(
    `SELECT criteria::text AS criteria_json FROM course_completion_rules
      WHERE course_id = $1 AND version = $2`,
    [input.courseId, input.criteriaVersion],
  );
  const rule = ruleRows[0];
  if (!rule) throw new Error('Frozen completion rules are missing');
  const criteria = parseCriteria(rule.criteria_json, input.criteriaVersion);

  const lessons = await listOrderedLessons(tx, input.courseId);
  const progress = await getProgressMap(tx, input.userId, input.courseId);
  const statuses = toStatusMap(progress);
  const completedLessons = lessons.filter(
    (lesson) => statuses[lesson.id] === 'completed',
  ).length;

  const { rows: quizRows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM quizzes q JOIN lessons l ON l.id = q.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1`,
    [input.courseId],
  );
  const quizCount = numberFrom(quizRows[0]?.count);
  const { rows: passedRows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM quiz_gradebook g
       JOIN quizzes q ON q.id = g.quiz_id
       JOIN lessons l ON l.id = q.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE g.user_id = $1 AND m.course_id = $2 AND g.passed = true`,
    [input.userId, input.courseId],
  );
  const passedQuizzes = numberFrom(passedRows[0]?.count);

  const allComplete =
    criteria.policy === 'all_required_lessons' &&
    lessons.length > 0 &&
    completedLessons === lessons.length &&
    passedQuizzes === quizCount;

  const { rows: existingRows } = await tx.query<{
    status: CompletionState;
    completed_at: Date | string | null;
  }>(
    `SELECT status, completed_at FROM course_completion
      WHERE user_id = $1 AND course_id = $2 FOR UPDATE`,
    [input.userId, input.courseId],
  );
  let record = existingRows[0];
  if (!record) {
    const { rows: inserted } = await tx.query<{
      status: CompletionState;
      completed_at: Date | string | null;
    }>(
      `INSERT INTO course_completion (user_id, course_id, criteria_version, status)
       VALUES ($1, $2, $3, 'in_progress')
       ON CONFLICT (user_id, course_id) DO UPDATE
         SET status = course_completion.status
       RETURNING status, completed_at`,
      [input.userId, input.courseId, input.criteriaVersion],
    );
    record = inserted[0];
  }
  if (!record) throw new Error('Course completion record missing');

  if (allComplete && record.status !== 'completed') {
    await tx.query(
      `UPDATE course_completion
          SET status = 'completed', completed_at = now()
        WHERE user_id = $1 AND course_id = $2`,
      [input.userId, input.courseId],
    );
    await tx.query(
      `UPDATE enrollments
          SET status = 'completed', completed_at = now()
        WHERE user_id = $1 AND course_id = $2 AND status <> 'completed'`,
      [input.userId, input.courseId],
    );
    await insertAuditEvent(tx, {
      actorUserId: input.userId,
      action: 'course.completed',
      targetType: 'course',
      targetId: input.courseId,
      metadata: {
        criteriaVersion: input.criteriaVersion,
        passingScorePercent: criteria.quizPassingScorePercent,
        completedLessons,
        totalLessons: lessons.length,
        certificateIssued: false,
      },
    });
  } else if (!allComplete && record.status === 'not_eligible') {
    await tx.query(
      `UPDATE course_completion SET status = 'in_progress', completed_at = NULL
        WHERE user_id = $1 AND course_id = $2`,
      [input.userId, input.courseId],
    );
  }

  return readCourseCompletionView(tx, input.userId, input.courseId, input.criteriaVersion);
}

// ---------------------------------------------------------------------------
// Progress events (exact-once, monotonic, concurrency-safe)
// ---------------------------------------------------------------------------

export interface RecordProgressEventInput {
  userId: string;
  courseId: string;
  lessonId: string;
  enrollmentId: string;
  criteriaVersion: number;
  clientId: string;
  clientEventId: string;
  sequence: number;
  eventType: ProgressEventType;
  occurredAt: string;
  progressPercent?: number;
  positionSeconds?: number;
  /** Server-generated quiz_passed events bypass per-client sequence checks. */
  internal?: boolean;
}

export interface ProgressEventCoreResult {
  clientEventId: string;
  outcome: ProgressOutcome;
  reason?: string;
  state: LessonProgressSnapshot;
}

export interface ProgressEventResult extends ProgressEventCoreResult {
  courseCompletion: CourseCompletionView;
}

async function ensureProgressRow(
  tx: DbClient,
  userId: string,
  lessonId: string,
  enrollmentId: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO lesson_progress (user_id, lesson_id, enrollment_id, status)
     VALUES ($1, $2, $3, 'not_started')
     ON CONFLICT (user_id, lesson_id) DO NOTHING`,
    [userId, lessonId, enrollmentId],
  );
}

async function loadProgressForUpdate(
  tx: DbClient,
  userId: string,
  lessonId: string,
): Promise<LessonProgressSnapshot> {
  const { rows } = await tx.query<LessonProgressDbRow>(
    `SELECT ${PROGRESS_COLUMNS} FROM lesson_progress
      WHERE user_id = $1 AND lesson_id = $2 FOR UPDATE`,
    [userId, lessonId],
  );
  const row = rows[0];
  return row ? toSnapshot(row) : emptyProgressSnapshot();
}

async function updateProgressGuarded(
  tx: DbClient,
  userId: string,
  lessonId: string,
  previousRevision: number,
  state: LessonProgressSnapshot,
): Promise<void> {
  const { rows } = await tx.query<{ revision: number }>(
    `UPDATE lesson_progress
        SET status = $3,
            progress_percent = $4,
            playback_position_seconds = $5,
            completed_at = $6::timestamptz,
            completion_source = $7,
            revision = $8,
            last_event_at = $9::timestamptz
      WHERE user_id = $1 AND lesson_id = $2 AND revision = $10
      RETURNING revision`,
    [
      userId,
      lessonId,
      state.status,
      state.progressPercent,
      state.playbackPositionSeconds,
      state.completedAt,
      state.completionSource,
      state.revision,
      state.lastEventAt,
      previousRevision,
    ],
  );
  if (!rows[0]) {
    throw new LearningError('invalid_transition', 'Progress changed concurrently. Please retry.');
  }
}

async function persistProgressEvent(
  tx: DbClient,
  input: RecordProgressEventInput,
  core: ProgressEventCoreResult,
): Promise<ProgressEventCoreResult> {
  const payload = JSON.stringify({
    progressPercent: input.progressPercent ?? null,
    positionSeconds: input.positionSeconds ?? null,
  });
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO progress_events
       (user_id, lesson_id, enrollment_id, client_id, client_event_id, sequence,
        event_type, payload, occurred_at, outcome, result, server_revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz, $10, $11::jsonb, $12)
     ON CONFLICT (user_id, client_event_id) DO NOTHING
     RETURNING id`,
    [
      input.userId,
      input.lessonId,
      input.enrollmentId,
      input.clientId,
      input.clientEventId,
      input.sequence,
      input.eventType,
      payload,
      input.occurredAt,
      core.outcome,
      JSON.stringify(core),
      core.state.revision,
    ],
  );
  if (rows[0]) return core;

  const { rows: existing } = await tx.query<{ result: unknown }>(
    `SELECT result FROM progress_events
      WHERE user_id = $1 AND client_event_id = $2`,
    [input.userId, input.clientEventId],
  );
  const stored = parseJsonValue<ProgressEventCoreResult>(existing[0]?.result ?? {});
  return {
    clientEventId: stored.clientEventId ?? input.clientEventId,
    outcome: 'duplicate',
    reason: 'duplicate_client_event',
    state: stored.state ?? emptyProgressSnapshot(),
  };
}

/**
 * Apply one event inside an existing transaction. Exact-once via unique client
 * event id; stale events (offline reconnects) never overwrite newer state;
 * `completed` is terminal. The caller owns the transaction boundary.
 */
export async function applyProgressEventInTransaction(
  tx: DbClient,
  input: RecordProgressEventInput,
): Promise<ProgressEventCoreResult> {
  const { rows: duplicates } = await tx.query<{ result: unknown }>(
    `SELECT result FROM progress_events
      WHERE user_id = $1 AND client_event_id = $2`,
    [input.userId, input.clientEventId],
  );
  if (duplicates[0]) {
    const stored = parseJsonValue<ProgressEventCoreResult>(duplicates[0].result);
    return { ...stored, outcome: 'duplicate', reason: 'duplicate_client_event' };
  }

  const serverNowIso = new Date().toISOString();
  await ensureProgressRow(tx, input.userId, input.lessonId, input.enrollmentId);

  if (!input.internal) {
    // Materialise then lock the per-device sequence row (conflict rule).
    await tx.query(
      `INSERT INTO progress_client_sequences (user_id, lesson_id, client_id, last_sequence)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id, lesson_id, client_id) DO NOTHING`,
      [input.userId, input.lessonId, input.clientId],
    );
    const { rows: sequenceRows } = await tx.query<{ last_sequence: string }>(
      `SELECT last_sequence FROM progress_client_sequences
        WHERE user_id = $1 AND lesson_id = $2 AND client_id = $3 FOR UPDATE`,
      [input.userId, input.lessonId, input.clientId],
    );
    const lastSequence = numberFrom(sequenceRows[0]?.last_sequence);
    if (classifyEventSequence(lastSequence, input.sequence) === 'stale') {
      const state = await loadProgressForUpdate(tx, input.userId, input.lessonId);
      return persistProgressEvent(tx, input, {
        clientEventId: input.clientEventId,
        outcome: 'stale',
        reason: 'stale_sequence',
        state,
      });
    }
    await tx.query(
      `UPDATE progress_client_sequences
          SET last_sequence = GREATEST(last_sequence, $4), updated_at = now()
        WHERE user_id = $1 AND lesson_id = $2 AND client_id = $3`,
      [input.userId, input.lessonId, input.clientId, input.sequence],
    );
  }

  const current = await loadProgressForUpdate(tx, input.userId, input.lessonId);
  const reduction = reduceLessonProgress(
    current,
    {
      eventType: input.eventType,
      progressPercent: input.progressPercent,
      positionSeconds: input.positionSeconds,
    },
    serverNowIso,
  );

  if (reduction.outcome === 'applied') {
    await updateProgressGuarded(
      tx,
      input.userId,
      input.lessonId,
      current.revision,
      reduction.state,
    );
  }

  return persistProgressEvent(tx, input, {
    clientEventId: input.clientEventId,
    outcome: reduction.outcome,
    reason: reduction.reason,
    state: reduction.state,
  });
}

/** Standalone progress mutation: event + course completion in ONE transaction. */
export async function recordProgressEvent(
  db: DbClient,
  input: RecordProgressEventInput,
): Promise<ProgressEventResult> {
  return db.transaction(async (tx) => {
    const core = await applyProgressEventInTransaction(tx, input);
    const courseCompletion = await evaluateCourseCompletionInTransaction(tx, {
      userId: input.userId,
      courseId: input.courseId,
      criteriaVersion: input.criteriaVersion,
    });
    return { ...core, courseCompletion };
  });
}

// ---------------------------------------------------------------------------
// Quiz reads (answer keys never leave this layer)
// ---------------------------------------------------------------------------

export interface QuizRow {
  id: string;
  lessonId: string;
  title: string;
  instructions: string | null;
}

export async function getQuizForLesson(db: DbClient, lessonId: string): Promise<QuizRow> {
  const { rows } = await db.query<{
    id: string;
    lesson_id: string;
    title: string;
    instructions: string | null;
  }>(
    `SELECT id::text, lesson_id::text, title, instructions FROM quizzes
      WHERE lesson_id = $1`,
    [lessonId],
  );
  const row = rows[0];
  if (!row) throw new LearningError('quiz_not_found', 'This lesson has no quiz configured.');
  return { id: row.id, lessonId: row.lesson_id, title: row.title, instructions: row.instructions };
}

function parseChoices(value: unknown): QuizChoice[] {
  const raw = parseJsonValue<unknown>(value);
  if (!Array.isArray(raw)) throw new Error('Quiz choices must be an array');
  return raw.map((item: unknown) => {
    const choice = parseJsonObject(item);
    if (
      typeof choice.id !== 'string' ||
      typeof choice.text !== 'string' ||
      typeof choice.isCorrect !== 'boolean'
    ) {
      throw new Error('Invalid quiz choice shape');
    }
    return { id: choice.id, text: choice.text, isCorrect: choice.isCorrect };
  });
}

export async function readGradableQuestions(
  db: DbClient,
  quizId: string,
): Promise<GradableQuestion[]> {
  const { rows } = await db.query<{
    id: string;
    kind: QuizQuestionKind;
    prompt: string;
    points: number;
    choices: unknown;
  }>(
    `SELECT id::text, kind, prompt, points, choices FROM quiz_questions
      WHERE quiz_id = $1 ORDER BY position`,
    [quizId],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    prompt: row.prompt,
    points: Number(row.points),
    choices: parseChoices(row.choices),
  }));
}

export async function getPublicQuizQuestions(
  db: DbClient,
  quizId: string,
): Promise<PublicQuizQuestion[]> {
  return toPublicQuestions(await readGradableQuestions(db, quizId));
}

export interface QuizSummaryView {
  bestScorePercent: number | null;
  latestScorePercent: number | null;
  attemptCount: number;
  passed: boolean;
}

export async function getQuizSummary(
  db: DbClient,
  userId: string,
  quizId: string,
): Promise<QuizSummaryView> {
  const { rows } = await db.query<{
    best_score_percent: string | null;
    latest_score_percent: string | null;
    attempt_count: number | null;
    passed: boolean | null;
  }>(
    `SELECT best_score_percent::text, latest_score_percent::text, attempt_count, passed
       FROM quiz_gradebook WHERE user_id = $1 AND quiz_id = $2`,
    [userId, quizId],
  );
  const row = rows[0];
  return {
    bestScorePercent: row?.best_score_percent === null || row?.best_score_percent === undefined
      ? null
      : numberFrom(row.best_score_percent),
    latestScorePercent: row?.latest_score_percent === null || row?.latest_score_percent === undefined
      ? null
      : numberFrom(row.latest_score_percent),
    attemptCount: Number(row?.attempt_count ?? 0),
    passed: row?.passed === true,
  };
}

// ---------------------------------------------------------------------------
// Gradebook reads
// ---------------------------------------------------------------------------

export interface GradebookEntryView {
  quizId: string;
  lessonId: string;
  quizTitle: string;
  lessonTitle: string;
  bestScorePercent: number | null;
  latestScorePercent: number | null;
  attemptCount: number;
  passed: boolean;
}

export interface GradebookView {
  quizCount: number;
  gradedQuizCount: number;
  attemptCount: number;
  averageBestScorePercent: number | null;
  latestScorePercent: number | null;
  entries: GradebookEntryView[];
}

export async function getGradebookView(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<GradebookView> {
  const { rows } = await db.query<{
    quiz_id: string;
    lesson_id: string;
    quiz_title: string;
    lesson_title: string;
    best_score_percent: string | null;
    latest_score_percent: string | null;
    attempt_count: number | null;
    passed: boolean | null;
  }>(
    `SELECT q.id::text AS quiz_id, q.lesson_id::text, q.title AS quiz_title,
            l.title AS lesson_title,
            g.best_score_percent::text, g.latest_score_percent::text,
            g.attempt_count, g.passed
       FROM quizzes q
       JOIN lessons l ON l.id = q.lesson_id
       JOIN modules m ON m.id = l.module_id
       LEFT JOIN quiz_gradebook g ON g.quiz_id = q.id AND g.user_id = $2
      WHERE m.course_id = $1
      ORDER BY m.position, l.position`,
    [courseId, userId],
  );

  const entries: GradebookEntryView[] = rows.map((row) => ({
    quizId: row.quiz_id,
    lessonId: row.lesson_id,
    quizTitle: row.quiz_title,
    lessonTitle: row.lesson_title,
    bestScorePercent: row.best_score_percent === null ? null : numberFrom(row.best_score_percent),
    latestScorePercent: row.latest_score_percent === null ? null : numberFrom(row.latest_score_percent),
    attemptCount: Number(row.attempt_count ?? 0),
    passed: row.passed === true,
  }));

  const bestScores = entries
    .map((entry) => entry.bestScorePercent)
    .filter((value): value is number => value !== null);
  const averageBestScorePercent =
    bestScores.length === 0
      ? null
      : Math.round((bestScores.reduce((sum, value) => sum + value, 0) / bestScores.length) * 100) / 100;

  const { rows: latest } = await db.query<{ score_percent: string }>(
    `SELECT score_percent::text FROM quiz_attempts
      WHERE user_id = $1 AND course_id = $2
      ORDER BY submitted_at DESC, id DESC LIMIT 1`,
    [userId, courseId],
  );

  return {
    quizCount: entries.length,
    gradedQuizCount: bestScores.length,
    attemptCount: entries.reduce((sum, entry) => sum + entry.attemptCount, 0),
    averageBestScorePercent,
    latestScorePercent: latest[0] ? numberFrom(latest[0].score_percent) : null,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Player read models
// ---------------------------------------------------------------------------

export interface LessonPlayerItem extends OrderedLesson {
  status: LessonProgressStatus;
  progressPercent: number;
  playbackPositionSeconds: number | null;
  completedAt: string | null;
  locked: boolean;
  requiresLessonTitle: string | null;
}

export interface CoursePlayerState {
  course: {
    id: string;
    slug: string;
    title: string;
    status: string;
    summary: string | null;
  };
  criteriaVersion: number;
  criteria: CourseCriteria;
  lessons: LessonPlayerItem[];
  progressPercent: number;
  completion: CourseCompletionView;
  gradebook: GradebookView;
  suggestedLessonId: string | null;
}

export async function getCoursePlayerState(
  db: DbClient,
  userId: string,
  courseSlug: string,
): Promise<CoursePlayerState> {
  const context = await getLearningCourseContext(db, userId, courseSlug);
  const lessons = await listOrderedLessons(db, context.courseId);
  const progress = await getProgressMap(db, userId, context.courseId);
  const statuses = toStatusMap(progress);
  const completion = await readCourseCompletionView(
    db,
    userId,
    context.courseId,
    context.criteriaVersion,
  );
  const gradebook = await getGradebookView(db, userId, context.courseId);

  const items: LessonPlayerItem[] = lessons.map((lesson) => {
    const snapshot = progress[lesson.id] ?? emptyProgressSnapshot();
    const unlock = isSequentialLessonUnlocked(lessons, statuses, lesson.id);
    return {
      ...lesson,
      status: snapshot.status,
      progressPercent: snapshot.progressPercent,
      playbackPositionSeconds: snapshot.playbackPositionSeconds,
      completedAt: snapshot.completedAt,
      locked: unlock.locked,
      requiresLessonTitle: unlock.requiresLessonTitle ?? null,
    };
  });

  return {
    course: {
      id: context.courseId,
      slug: context.courseSlug,
      title: context.courseTitle,
      status: context.courseStatus,
      summary: context.courseSummary,
    },
    criteriaVersion: context.criteriaVersion,
    criteria: context.criteria,
    lessons: items,
    progressPercent: completion.progressPercent,
    completion,
    gradebook,
    suggestedLessonId: firstIncompleteLessonId(lessons, statuses),
  };
}

export type LessonDetailContent =
  | { kind: 'video' | 'download'; media: MediaGrantView }
  | { kind: 'text'; bodyText: string }
  | {
      kind: 'quiz';
      quiz: {
        id: string;
        title: string;
        instructions: string | null;
        questions: PublicQuizQuestion[];
        passingScorePercent: number;
        bestScorePercent: number | null;
        latestScorePercent: number | null;
        attemptCount: number;
        passed: boolean;
      };
    };

export interface LessonDetailView {
  lesson: OrderedLesson & { courseId: string; courseSlug: string };
  course: { id: string; slug: string; title: string };
  criteriaVersion: number;
  progress: LessonProgressSnapshot;
  completion: CourseCompletionView;
  gradebook: GradebookView;
  content: LessonDetailContent;
  nextLessonId: string | null;
  previousLessonId: string | null;
}

export async function getLessonDetail(
  db: DbClient,
  userId: string,
  lessonId: string,
): Promise<LessonDetailView> {
  const { lesson, context, lessons, progress } = await getLessonContext(db, userId, lessonId);
  const snapshot = progress[lesson.id] ?? emptyProgressSnapshot();
  const completion = await readCourseCompletionView(
    db,
    userId,
    context.courseId,
    context.criteriaVersion,
  );
  const gradebook = await getGradebookView(db, userId, context.courseId);

  let content: LessonDetailContent;
  if (lesson.kind === 'video' || lesson.kind === 'download') {
    const asset = await getLessonMediaAsset(db, lessonId);
    if (!asset) {
      throw new LearningError('content_not_configured', 'This lesson has no media configured.');
    }
    const purpose = lesson.kind === 'video' ? 'stream' : 'download';
    const media = await createMediaGrant(db, { userId, lessonId, purpose });
    content = { kind: lesson.kind, media };
  } else if (lesson.kind === 'text') {
    const { rows } = await db.query<{ body_text: string | null }>(
      `SELECT body_text FROM lesson_content WHERE lesson_id = $1`,
      [lessonId],
    );
    const body = rows[0]?.body_text;
    if (!body) {
      throw new LearningError('content_not_configured', 'This lesson has no text configured.');
    }
    content = { kind: 'text', bodyText: body };
  } else {
    const quiz = await getQuizForLesson(db, lessonId);
    const questions = await getPublicQuizQuestions(db, quiz.id);
    if (questions.length === 0) {
      throw new LearningError('content_not_configured', 'This quiz has no questions configured.');
    }
    const summary = await getQuizSummary(db, userId, quiz.id);
    content = {
      kind: 'quiz',
      quiz: {
        id: quiz.id,
        title: quiz.title,
        instructions: quiz.instructions,
        questions,
        passingScorePercent: context.criteria.quizPassingScorePercent,
        bestScorePercent: summary.bestScorePercent,
        latestScorePercent: summary.latestScorePercent,
        attemptCount: summary.attemptCount,
        passed: summary.passed,
      },
    };
  }

  return {
    lesson,
    course: { id: context.courseId, slug: context.courseSlug, title: context.courseTitle },
    criteriaVersion: context.criteriaVersion,
    progress: snapshot,
    completion,
    gradebook,
    content,
    nextLessonId: nextLessonId(lessons, lessonId),
    previousLessonId: previousLessonId(lessons, lessonId),
  };
}
