import type { DbClient } from '../client.js';
import {
  canonicalAnswers,
  gradeObjectiveQuiz,
  nextLessonId,
  type QuestionGrade,
  type QuizAnswers,
} from '../domain/index.js';
import { insertAuditEvent } from './audit.js';
import { LearningError } from './learning-errors.js';
import {
  applyProgressEventInTransaction,
  evaluateCourseCompletionInTransaction,
  getGradebookView,
  getLessonContext,
  getLessonProgressSnapshot,
  getQuizForLesson,
  numberFrom,
  parseJsonValue,
  readGradableQuestions,
  toIso,
  type CourseCompletionView,
  type GradebookView,
} from './learning.js';
import type { LessonProgressSnapshot } from '../domain/lesson-progress.js';

export interface QuizAttemptDbRow {
  id: string;
  attempt_no: number;
  score_percent: string;
  points_earned: string;
  points_possible: string;
  passing_score_percent: number;
  passed: boolean;
  submitted_at: Date | string;
  answers: unknown;
}

export interface QuizAttemptView {
  id: string;
  attemptNo: number;
  scorePercent: number;
  pointsEarned: number;
  pointsPossible: number;
  passingScorePercent: number;
  passed: boolean;
  submittedAt: string;
  /** The learner's own canonical selections — never the answer key. */
  answers: QuizAnswers;
  /** Correct/incorrect per question only; no correct choice ids. */
  perQuestion: QuestionGrade[];
}

export interface SubmitQuizAttemptInput {
  userId: string;
  lessonId: string;
  clientSubmissionId: string;
  answers: QuizAnswers;
}

export interface SubmitQuizAttemptResult {
  outcome: 'submitted' | 'duplicate';
  attempt: QuizAttemptView;
  lessonProgress: LessonProgressSnapshot;
  gradebook: GradebookView;
  courseCompletion: CourseCompletionView;
  courseSlug: string;
  nextLessonId: string | null;
}

const QUIZ_ATTEMPT_COLUMNS = `
  id::text, attempt_no, score_percent::text AS score_percent,
  points_earned::text AS points_earned, points_possible::text AS points_possible,
  passing_score_percent, passed, submitted_at, answers`;

function toAttemptView(
  row: QuizAttemptDbRow,
  answers: QuizAnswers,
  perQuestion: QuestionGrade[],
): QuizAttemptView {
  return {
    id: row.id,
    attemptNo: Number(row.attempt_no),
    scorePercent: numberFrom(row.score_percent),
    pointsEarned: numberFrom(row.points_earned),
    pointsPossible: numberFrom(row.points_possible),
    passingScorePercent: Number(row.passing_score_percent),
    passed: row.passed === true,
    submittedAt: toIso(row.submitted_at) ?? new Date().toISOString(),
    answers,
    perQuestion,
  };
}

interface GradebookUpdateInput {
  userId: string;
  courseId: string;
  quizId: string;
  lessonId: string;
  attemptId: string;
  scorePercent: number;
  passed: boolean;
}

/** Transactional per-quiz best score + course average of best scores (Q3). */
export async function updateGradebooksInTransaction(
  tx: DbClient,
  input: GradebookUpdateInput,
): Promise<void> {
  await tx.query(
    `INSERT INTO quiz_gradebook
       (user_id, quiz_id, lesson_id, course_id, best_score_percent,
        latest_score_percent, best_attempt_id, latest_attempt_id, attempt_count, passed)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $6, 1, $7)
     ON CONFLICT (user_id, quiz_id) DO UPDATE SET
       best_score_percent = GREATEST(quiz_gradebook.best_score_percent, EXCLUDED.best_score_percent),
       best_attempt_id = CASE
         WHEN EXCLUDED.best_score_percent > quiz_gradebook.best_score_percent
           THEN EXCLUDED.best_attempt_id
         ELSE quiz_gradebook.best_attempt_id END,
       latest_score_percent = EXCLUDED.latest_score_percent,
       latest_attempt_id = EXCLUDED.latest_attempt_id,
       attempt_count = quiz_gradebook.attempt_count + 1,
       passed = quiz_gradebook.passed OR EXCLUDED.passed,
       updated_at = now()`,
    [
      input.userId,
      input.quizId,
      input.lessonId,
      input.courseId,
      input.scorePercent,
      input.attemptId,
      input.passed,
    ],
  );

  const { rows: quizCountRows } = await tx.query<{ quiz_count: number }>(
    `SELECT count(*)::int AS quiz_count
       FROM quizzes q JOIN lessons l ON l.id = q.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1`,
    [input.courseId],
  );
  const { rows: aggregateRows } = await tx.query<{
    graded_quiz_count: number;
    attempt_count: number;
    average_best_score_percent: string | null;
  }>(
    `SELECT count(*)::int AS graded_quiz_count,
            coalesce(sum(attempt_count), 0)::int AS attempt_count,
            round(avg(best_score_percent), 2)::text AS average_best_score_percent
       FROM quiz_gradebook WHERE user_id = $1 AND course_id = $2`,
    [input.userId, input.courseId],
  );
  const { rows: latestRows } = await tx.query<{ score_percent: string }>(
    `SELECT score_percent::text FROM quiz_attempts
      WHERE user_id = $1 AND course_id = $2
      ORDER BY submitted_at DESC, id DESC LIMIT 1`,
    [input.userId, input.courseId],
  );
  const aggregate = aggregateRows[0];
  const average =
    aggregate?.average_best_score_percent === null ||
    aggregate?.average_best_score_percent === undefined
      ? null
      : numberFrom(aggregate.average_best_score_percent);
  const latest = latestRows[0] ? numberFrom(latestRows[0].score_percent) : null;

  await tx.query(
    `INSERT INTO course_gradebook
       (user_id, course_id, quiz_count, graded_quiz_count, attempt_count,
        average_best_score_percent, latest_score_percent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, course_id) DO UPDATE SET
       quiz_count = EXCLUDED.quiz_count,
       graded_quiz_count = EXCLUDED.graded_quiz_count,
       attempt_count = EXCLUDED.attempt_count,
       average_best_score_percent = EXCLUDED.average_best_score_percent,
       latest_score_percent = EXCLUDED.latest_score_percent,
       updated_at = now()`,
    [
      input.userId,
      input.courseId,
      Number(quizCountRows[0]?.quiz_count ?? 0),
      Number(aggregate?.graded_quiz_count ?? 0),
      Number(aggregate?.attempt_count ?? 0),
      average,
      latest,
    ],
  );
}

/**
 * Submit, auto-grade and record one objective quiz attempt.
 * - idempotent on `clientSubmissionId` (rapid double clicks / retries);
 * - unlimited attempts; passing score comes from the FROZEN criteria version;
 * - a pass advances the lesson state machine via an internal `quiz_passed`
 *   event, then re-evaluates course completion — all in ONE transaction.
 */
export async function submitQuizAttempt(
  db: DbClient,
  input: SubmitQuizAttemptInput,
): Promise<SubmitQuizAttemptResult> {
  return db.transaction(async (tx) => {
    const context = await getLessonContext(tx, input.userId, input.lessonId);
    if (context.lesson.kind !== 'quiz') {
      throw new LearningError(
        'unsupported_lesson_kind',
        'This lesson is not a quiz.',
      );
    }
    const quiz = await getQuizForLesson(tx, input.lessonId);
    const questions = await readGradableQuestions(tx, quiz.id);
    if (questions.length === 0) {
      throw new LearningError('content_not_configured', 'This quiz has no questions configured.');
    }
    const canonical = canonicalAnswers(questions, input.answers);
    const canonicalJson = JSON.stringify(canonical);
    // JSONB may reorder object keys, so compare canonicalised selections rather
    // than raw JSON strings when detecting a conflicting duplicate submission.
    const sameAnswers = (stored: QuizAnswers): boolean =>
      JSON.stringify(canonicalAnswers(questions, stored)) === canonicalJson;

    const { rows: duplicateRows } = await tx.query<QuizAttemptDbRow>(
      `SELECT ${QUIZ_ATTEMPT_COLUMNS} FROM quiz_attempts
        WHERE user_id = $1 AND client_submission_id = $2`,
      [input.userId, input.clientSubmissionId],
    );
    const duplicate = duplicateRows[0];
    if (duplicate) {
      const storedAnswers = parseJsonValue<QuizAnswers>(duplicate.answers);
      if (!sameAnswers(storedAnswers)) {
        throw new LearningError(
          'submission_conflict',
          'This submission id was already used with different answers.',
        );
      }
      const grade = gradeObjectiveQuiz(
        questions,
        storedAnswers,
        Number(duplicate.passing_score_percent),
      );
      const completion = await evaluateCourseCompletionInTransaction(tx, {
        userId: input.userId,
        courseId: context.context.courseId,
        criteriaVersion: context.context.criteriaVersion,
      });
      return {
        outcome: 'duplicate' as const,
        attempt: toAttemptView(duplicate, storedAnswers, grade.perQuestion),
        lessonProgress: await getLessonProgressSnapshot(tx, input.userId, input.lessonId),
        gradebook: await getGradebookView(tx, input.userId, context.context.courseId),
        courseCompletion: completion,
        courseSlug: context.context.courseSlug,
        nextLessonId: nextLessonId(context.lessons, input.lessonId),
      };
    }

    // Serialise attempt numbering for this learner + quiz.
    await tx.query(`SELECT id FROM quizzes WHERE id = $1 FOR UPDATE`, [quiz.id]);
    const { rows: attemptNoRows } = await tx.query<{ attempt_no: number }>(
      `SELECT coalesce(max(attempt_no), 0) + 1 AS attempt_no
         FROM quiz_attempts WHERE user_id = $1 AND quiz_id = $2`,
      [input.userId, quiz.id],
    );
    const attemptNo = Number(attemptNoRows[0]?.attempt_no ?? 1);
    const passingScorePercent = context.context.criteria.quizPassingScorePercent;
    const grade = gradeObjectiveQuiz(questions, canonical, passingScorePercent);

    const { rows: inserted } = await tx.query<QuizAttemptDbRow>(
      `INSERT INTO quiz_attempts
         (user_id, course_id, quiz_id, lesson_id, enrollment_id, criteria_version,
          attempt_no, client_submission_id, answers, points_earned, points_possible,
          score_percent, passing_score_percent, passed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
       RETURNING ${QUIZ_ATTEMPT_COLUMNS}`,
      [
        input.userId,
        context.context.courseId,
        quiz.id,
        input.lessonId,
        context.context.enrollmentId,
        context.context.criteriaVersion,
        attemptNo,
        input.clientSubmissionId,
        canonicalJson,
        grade.pointsEarned,
        grade.pointsPossible,
        grade.scorePercent,
        passingScorePercent,
        grade.passed,
      ],
    );
    const attempt = inserted[0];
    if (!attempt) throw new Error('Quiz attempt insert returned no row');

    await updateGradebooksInTransaction(tx, {
      userId: input.userId,
      courseId: context.context.courseId,
      quizId: quiz.id,
      lessonId: input.lessonId,
      attemptId: attempt.id,
      scorePercent: grade.scorePercent,
      passed: grade.passed,
    });

    const submittedAt = toIso(attempt.submitted_at) ?? new Date().toISOString();
    const eventBase = {
      userId: input.userId,
      courseId: context.context.courseId,
      lessonId: input.lessonId,
      enrollmentId: context.context.enrollmentId,
      criteriaVersion: context.context.criteriaVersion,
      clientId: 'server',
      sequence: 1,
      occurredAt: submittedAt,
      internal: true,
    };
    // A submission is engagement, but not completion by itself.
    await applyProgressEventInTransaction(tx, {
      ...eventBase,
      clientEventId: `quiz-start:${attempt.id}`,
      eventType: 'start',
      progressPercent: 0,
    });
    if (grade.passed) {
      await applyProgressEventInTransaction(tx, {
        ...eventBase,
        clientEventId: `quiz-passed:${attempt.id}`,
        eventType: 'quiz_passed',
        progressPercent: 100,
      });
    }

    await insertAuditEvent(tx, {
      actorUserId: input.userId,
      action: 'quiz.submitted',
      targetType: 'quiz_attempt',
      targetId: attempt.id,
      metadata: {
        quizId: quiz.id,
        lessonId: input.lessonId,
        attemptNo,
        scorePercent: grade.scorePercent,
        passed: grade.passed,
        criteriaVersion: context.context.criteriaVersion,
      },
    });

    const completion = await evaluateCourseCompletionInTransaction(tx, {
      userId: input.userId,
      courseId: context.context.courseId,
      criteriaVersion: context.context.criteriaVersion,
    });

    return {
      outcome: 'submitted' as const,
      attempt: toAttemptView(attempt, canonical, grade.perQuestion),
      lessonProgress: await getLessonProgressSnapshot(tx, input.userId, input.lessonId),
      gradebook: await getGradebookView(tx, input.userId, context.context.courseId),
      courseCompletion: completion,
      courseSlug: context.context.courseSlug,
      nextLessonId: nextLessonId(context.lessons, input.lessonId),
    };
  });
}
