import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { progressBatchChecksum, type CanonicalProgressEvent } from '@lms/shared';
import { api, createTestApp, register, type TestApp } from './helpers.js';
import {
  grantLearningAccess,
  makeFixtureUser,
  seedLearningCourse,
  type LearningCourseSeed,
} from './fixtures.js';

type Jar = Awaited<ReturnType<typeof register>>['jar'];
type ProgressEventType = 'start' | 'position' | 'complete';

const CLIENT_ID = 'phase3-integration-device';
const FIXTURE_VIDEO = new URL('../assets/fixtures/lesson-intro.mp4', import.meta.url);

let test: TestApp;
let instructorId: string;
let learnerId: string;
let learnerJar: Jar;
let seed: LearningCourseSeed;

function event(
  sequence: number,
  type: ProgressEventType,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clientEventId: randomUUID(),
    sequence,
    type,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function progressBatch(lessonId: string, events: Record<string, unknown>[]) {
  const checksum = progressBatchChecksum({
    clientId: CLIENT_ID,
    events: events as unknown as CanonicalProgressEvent[],
  });
  return api(test.app, learnerJar)
    .post(`/api/learning/lessons/${lessonId}/progress/events`)
    .send({ clientId: CLIENT_ID, events, checksum });
}

function completeExplicit(lessonId: string, sequence = 1) {
  return progressBatch(lessonId, [event(sequence, 'complete', { progressPercent: 100 })]);
}

function submitQuiz(
  lessonId: string,
  answers: Record<string, string[]>,
  clientSubmissionId = randomUUID(),
) {
  return api(test.app, learnerJar)
    .post(`/api/learning/lessons/${lessonId}/quiz/attempts`)
    .send({ clientSubmissionId, answers });
}

function getPlayer() {
  return api(test.app, learnerJar).get(`/api/learning/courses/${seed.slug}`);
}

function partialAnswers(course: LearningCourseSeed): Record<string, string[]> {
  const ids = Object.keys(course.correctAnswers);
  const last = ids[ids.length - 1];
  if (!last) throw new Error('quiz seed has no questions');
  return { ...course.correctAnswers, [last]: course.wrongAnswers[last] ?? [] };
}

async function completeFirstTwo(): Promise<void> {
  const first = await completeExplicit(seed.lessons[0]!.id);
  expect(first.status).toBe(200);
  expect(first.body.progress.status).toBe('completed');
  const second = await completeExplicit(seed.lessons[1]!.id);
  expect(second.status).toBe(200);
  expect(second.body.progress.status).toBe('completed');
}

async function passFirstQuiz(): Promise<void> {
  await completeFirstTwo();
  const passed = await submitQuiz(seed.lessons[2]!.id, seed.correctAnswers);
  expect(passed.status).toBe(201);
  expect(passed.body.attempt.passed).toBe(true);
  expect(passed.body.attempt.scorePercent).toBe(100);
  expect(passed.body.lessonProgress.status).toBe('completed');
  expect(passed.body.lessonProgress.completionSource).toBe('quiz_pass');
}

async function addSecondQuiz(courseId: string): Promise<{
  lessonId: string;
  quizId: string;
  correctAnswers: Record<string, string[]>;
  wrongAnswers: Record<string, string[]>;
  eightyPercentAnswers: Record<string, string[]>;
}> {
  const { rows: modules } = await test.db.query<{ id: string }>(
    `SELECT m.id::text FROM modules m WHERE m.course_id = $1 ORDER BY m.position DESC LIMIT 1`,
    [courseId],
  );
  const moduleId = modules[0]?.id;
  if (!moduleId) throw new Error('no module for second quiz');

  const { rows: lessonRows } = await test.db.query<{ id: string }>(
    `INSERT INTO lessons (module_id, title, position, kind)
     VALUES ($1, 'Second checkpoint', 3, 'quiz') RETURNING id::text`,
    [moduleId],
  );
  const lessonId = lessonRows[0]?.id;
  if (!lessonId) throw new Error('second quiz lesson insert failed');

  const { rows: quizRows } = await test.db.query<{ id: string }>(
    `INSERT INTO quizzes (lesson_id, title, instructions)
     VALUES ($1, 'Second checkpoint', 'Answer four of five correctly to pass.')
     RETURNING id::text`,
    [lessonId],
  );
  const quizId = quizRows[0]?.id;
  if (!quizId) throw new Error('second quiz insert failed');

  const correctAnswers: Record<string, string[]> = {};
  const wrongAnswers: Record<string, string[]> = {};
  for (let position = 1; position <= 5; position += 1) {
    const { rows } = await test.db.query<{ id: string }>(
      `INSERT INTO quiz_questions (quiz_id, position, kind, prompt, points, choices)
       VALUES ($1, $2, 'single_choice', $3, 1, $4::jsonb) RETURNING id::text`,
      [
        quizId,
        position,
        `Second checkpoint question ${position}`,
        JSON.stringify([
          { id: 'a', text: 'Correct', isCorrect: true },
          { id: 'b', text: 'Incorrect', isCorrect: false },
        ]),
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('second quiz question insert failed');
    correctAnswers[id] = ['a'];
    wrongAnswers[id] = ['b'];
  }
  const ids = Object.keys(correctAnswers);
  const last = ids[ids.length - 1];
  if (!last) throw new Error('second quiz has no questions');
  const eightyPercentAnswers = { ...correctAnswers, [last]: ['b'] };
  return { lessonId, quizId, correctAnswers, wrongAnswers, eightyPercentAnswers };
}

function binaryParser(
  res: { on: (event: string, listener: (...args: unknown[]) => void) => void },
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: unknown) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error: unknown) =>
    callback(error instanceof Error ? error : new Error('stream failed')),
  );
}

async function binaryGet(url: string, jar: Jar, range?: string) {
  let req = request(test.app)
    .get(url)
    .set('Cookie', jar.header())
    .buffer(true)
    .parse(binaryParser);
  if (range) req = req.set('Range', range);
  return req;
}

describe('Phase 3 learning journey (API integration)', () => {
  beforeAll(async () => {
    test = await createTestApp();
    const instructor = await makeFixtureUser(test.db, { name: 'Phase 3 Instructor' });
    instructorId = instructor.id;
    const registration = await register(test.app, { email: 'phase3-learner@example.com' });
    expect(registration.res.status).toBe(201);
    learnerJar = registration.jar;
    learnerId = registration.res.body.user.id as string;
  });

  afterAll(async () => {
    await test.close();
  });

  beforeEach(async () => {
    seed = await seedLearningCourse(test.db, {
      createdBy: instructorId,
      slug: `phase3-course-${randomUUID().slice(0, 8)}`,
    });
    await grantLearningAccess(test.db, learnerId, seed.id);
  });

  it('freezes completion-rule version 1 on enrolment even after a new active version is added', async () => {
    const before = await getPlayer();
    expect(before.status).toBe(200);
    expect(before.body.criteriaVersion).toBe(1);
    expect(before.body.criteria.quizPassingScorePercent).toBe(80);
    expect(before.body.course.href).toBe(`/learn/${seed.slug}`);
    expect(before.body.lessons).toHaveLength(4);
    expect(before.body.lessons[0].locked).toBe(false);
    expect(before.body.lessons[1].locked).toBe(true);

    await test.db.query(
      `UPDATE course_completion_rules SET is_active = false WHERE course_id = $1 AND version = 1`,
      [seed.id],
    );
    await test.db.query(
      `INSERT INTO course_completion_rules (course_id, version, criteria, is_active)
       VALUES ($1, 2, $2::jsonb, true)`,
      [
        seed.id,
        JSON.stringify({
          policy: 'all_required_lessons',
          lessonOrder: 'module_position_then_lesson_position',
          videoCompletion: 'explicit',
          quizPassingScorePercent: 90,
        }),
      ],
    );

    const after = await getPlayer();
    expect(after.body.criteriaVersion).toBe(1);
    expect(after.body.criteria.quizPassingScorePercent).toBe(80);
    const { rows } = await test.db.query<{ criteria_version: number }>(
      `SELECT criteria_version FROM enrollments WHERE user_id = $1 AND course_id = $2`,
      [learnerId, seed.id],
    );
    expect(rows[0]?.criteria_version).toBe(1);
  });

  it('enforces sequential unlock, explicit completion and rejects skipping ahead', async () => {
    const lockedDetail = await api(test.app, learnerJar).get(
      `/api/learning/lessons/${seed.lessons[3]!.id}`,
    );
    expect(lockedDetail.status).toBe(403);
    expect(lockedDetail.body.error.code).toBe('lesson_locked');
    expect(lockedDetail.body.error.details.requiresLessonTitle).toBeTruthy();

    const lockedProgress = await progressBatch(seed.lessons[3]!.id, [
      event(1, 'complete', { progressPercent: 100 }),
    ]);
    expect(lockedProgress.status).toBe(403);
    expect(lockedProgress.body.error.code).toBe('lesson_locked');

    const lockedMedia = await api(test.app, learnerJar)
      .post(`/api/learning/lessons/${seed.lessons[3]!.id}/media`)
      .send({ purpose: 'download' });
    expect(lockedMedia.status).toBe(403);
    expect(lockedMedia.body.error.code).toBe('lesson_locked');

    // Page visit alone neither completes nor starts progress server-side.
    const videoDetail = await api(test.app, learnerJar).get(
      `/api/learning/lessons/${seed.lessons[0]!.id}`,
    );
    expect(videoDetail.status).toBe(200);
    expect(videoDetail.body.progress.status).toBe('not_started');
    expect(videoDetail.body.progress.completionSource).toBeNull();

    // Even 100% watched is engagement, not completion.
    const watched = await progressBatch(seed.lessons[0]!.id, [
      event(1, 'position', { progressPercent: 100, positionSeconds: 4 }),
    ]);
    expect(watched.body.results[0].outcome).toBe('applied');
    expect(watched.body.progress.status).toBe('in_progress');
    expect(watched.body.progress.progressPercent).toBe(100);
    expect(watched.body.progress.completedAt).toBeNull();

    const completed = await completeExplicit(seed.lessons[0]!.id, 2);
    expect(completed.body.progress.status).toBe('completed');
    expect(completed.body.progress.completionSource).toBe('explicit');

    const player = await getPlayer();
    expect(player.body.lessons[1].locked).toBe(false);
    expect(player.body.lessons[2].locked).toBe(true);
    expect(player.body.progressPercent).toBe(25);
  });

  it('handles rapid clicks, offline replay duplicates, stale sequences and terminal completion', async () => {
    const rapidEvents = [
      event(1, 'complete', { progressPercent: 100 }),
      event(2, 'complete', { progressPercent: 100 }),
    ];
    const rapid = await progressBatch(seed.lessons[0]!.id, rapidEvents);
    expect(rapid.status).toBe(200);
    expect(rapid.body.results[0].outcome).toBe('applied');
    expect(rapid.body.results[1].outcome).toBe('ignored');
    expect(rapid.body.results[1].reason).toBe('completed_is_terminal');
    expect(rapid.body.progress.status).toBe('completed');

    const revision = rapid.body.progress.revision as number;

    // Simulate an offline client reconnecting and replaying the exact same
    // batch (same client event ids): exact-once, no new progress rows.
    const replay = await progressBatch(seed.lessons[0]!.id, rapidEvents);
    expect(replay.body.results.map((result: { outcome: string }) => result.outcome)).toEqual([
      'duplicate',
      'duplicate',
    ]);
    expect(replay.body.progress.status).toBe('completed');
    expect(replay.body.progress.revision).toBe(revision);

    // An old client with a lower sequence cannot regress newer state.
    const stale = await progressBatch(seed.lessons[0]!.id, [
      event(1, 'position', { progressPercent: 10, positionSeconds: 1 }),
    ]);
    expect(stale.body.results[0].outcome).toBe('stale');
    expect(stale.body.results[0].reason).toBe('stale_sequence');
    expect(stale.body.progress.status).toBe('completed');
    expect(stale.body.progress.revision).toBe(revision);
    expect(stale.body.courseCompletion.progressPercent).toBe(25);

    const { rows } = await test.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM progress_events WHERE user_id = $1 AND lesson_id = $2`,
      [learnerId, seed.lessons[0]!.id],
    );
    // Two rapid events + one stale event; the replayed batch is deduplicated.
    expect(Number(rows[0]?.count)).toBe(3);
  });

  it('auto-grades quizzes, never exposes answer keys, supports unlimited retakes and best scores', async () => {
    await completeFirstTwo();

    const detail = await api(test.app, learnerJar).get(
      `/api/learning/lessons/${seed.lessons[2]!.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.content.kind).toBe('quiz');
    expect(detail.body.content.quiz.passingScorePercent).toBe(80);
    const serialized = JSON.stringify(detail.body);
    expect(serialized).not.toContain('isCorrect');
    expect(serialized).not.toContain('correctChoiceIds');
    expect(serialized).not.toContain('answerKey');
    for (const question of detail.body.content.quiz.questions) {
      for (const choice of question.choices) {
        expect(Object.keys(choice).sort()).toEqual(['id', 'text']);
      }
    }
    const { rows: storedQuestions } = await test.db.query<{ choices: string }>(
      `SELECT choices::text FROM quiz_questions WHERE quiz_id = $1`,
      [seed.quizId],
    );
    expect(storedQuestions.some((row) => row.choices.includes('isCorrect'))).toBe(true);

    const completeRejected = await progressBatch(seed.lessons[2]!.id, [
      event(1, 'complete', { progressPercent: 100 }),
    ]);
    expect(completeRejected.status).toBe(400);
    expect(completeRejected.body.error.code).toBe('quiz_completion_requires_pass');

    const partial = await submitQuiz(seed.lessons[2]!.id, partialAnswers(seed));
    expect(partial.status).toBe(201);
    expect(partial.body.attempt.scorePercent).toBe(66.67);
    expect(partial.body.attempt.passed).toBe(false);
    expect(partial.body.lessonProgress.status).toBe('in_progress');

    const wrong = await submitQuiz(seed.lessons[2]!.id, { ...seed.wrongAnswers });
    expect(wrong.status).toBe(201);
    expect(wrong.body.attempt.attemptNo).toBe(2);
    expect(wrong.body.attempt.scorePercent).toBe(0);
    expect(wrong.body.attempt.passed).toBe(false);

    const submissionId = randomUUID();
    const passed = await submitQuiz(seed.lessons[2]!.id, seed.correctAnswers, submissionId);
    expect(passed.status).toBe(201);
    expect(passed.body.attempt.attemptNo).toBe(3);
    expect(passed.body.attempt.scorePercent).toBe(100);
    expect(passed.body.attempt.passed).toBe(true);
    expect(passed.body.lessonProgress.status).toBe('completed');
    expect(passed.body.lessonProgress.completionSource).toBe('quiz_pass');
    expect(passed.body.gradebook.averageBestScorePercent).toBe(100);
    expect(passed.body.gradebook.attemptCount).toBe(3);
    expect(passed.body.gradebook.entries[0].bestScorePercent).toBe(100);
    expect(passed.body.attempt.perQuestion.every((item: { correct: boolean }) => item.correct)).toBe(true);

    const duplicate = await submitQuiz(seed.lessons[2]!.id, seed.correctAnswers, submissionId);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.outcome).toBe('duplicate');
    expect(duplicate.body.attempt.id).toBe(passed.body.attempt.id);
    expect(duplicate.body.gradebook.attemptCount).toBe(3);

    const conflict = await submitQuiz(seed.lessons[2]!.id, { ...seed.wrongAnswers }, submissionId);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('submission_conflict');

    const gradebook = await api(test.app, learnerJar).get(
      `/api/learning/courses/${seed.slug}/gradebook`,
    );
    expect(gradebook.status).toBe(200);
    expect(gradebook.body.criteriaVersion).toBe(1);
    expect(gradebook.body.gradebook.averageBestScorePercent).toBe(100);
  });

  it('averages best scores across quizzes, completes the course and issues no certificate', async () => {
    const second = await addSecondQuiz(seed.id);
    await passFirstQuiz();

    const download = await completeExplicit(seed.lessons[3]!.id);
    expect(download.status).toBe(200);
    expect(download.body.progress.status).toBe('completed');

    const unlocked = await api(test.app, learnerJar).get(
      `/api/learning/lessons/${second.lessonId}`,
    );
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.content.kind).toBe('quiz');

    const secondAttempt = await submitQuiz(second.lessonId, second.eightyPercentAnswers);
    expect(secondAttempt.status).toBe(201);
    expect(secondAttempt.body.attempt.scorePercent).toBe(80);
    expect(secondAttempt.body.attempt.passed).toBe(true);
    expect(secondAttempt.body.gradebook.quizCount).toBe(2);
    expect(secondAttempt.body.gradebook.averageBestScorePercent).toBe(90);
    expect(secondAttempt.body.courseCompletion.status).toBe('completed');
    expect(secondAttempt.body.courseCompletion.progressPercent).toBe(100);

    const { rows: gradebookRows } = await test.db.query<{ average_best_score_percent: string }>(
      `SELECT average_best_score_percent::text FROM course_gradebook WHERE user_id = $1 AND course_id = $2`,
      [learnerId, seed.id],
    );
    expect(Number(gradebookRows[0]?.average_best_score_percent)).toBe(90);

    const { rows: completionRows } = await test.db.query<{ status: string; criteria_version: number }>(
      `SELECT status, criteria_version FROM course_completion WHERE user_id = $1 AND course_id = $2`,
      [learnerId, seed.id],
    );
    expect(completionRows[0]?.status).toBe('completed');
    expect(completionRows[0]?.status).not.toBe('certificate_issued');
    expect(completionRows[0]?.criteria_version).toBe(1);

    const { rows: enrollmentRows } = await test.db.query<{ status: string }>(
      `SELECT status FROM enrollments WHERE user_id = $1 AND course_id = $2`,
      [learnerId, seed.id],
    );
    expect(enrollmentRows[0]?.status).toBe('completed');

    const { rows: auditRows } = await test.db.query<{ metadata: unknown }>(
      `SELECT metadata FROM audit_events WHERE action = 'course.completed' AND actor_user_id = $1`,
      [learnerId],
    );
    expect(JSON.stringify(auditRows[0]?.metadata ?? {})).toContain('"certificateIssued":false');

    const library = await api(test.app, learnerJar).get('/api/me/enrollments');
    expect(library.status).toBe(200);
    const item = library.body.items.find((entry: { course: { slug: string } }) => entry.course.slug === seed.slug);
    expect(item.learning.progressPercent).toBe(100);
    expect(item.learning.completedLessons).toBe(5);
    expect(item.learning.totalLessons).toBe(5);
    expect(item.learning.completionStatus).toBe('completed');
    expect(item.learning.gradebookAverage).toBe(90);
  });

  it('delivers authorized scoped media bytes with ranges, expiry and entitlement re-checks', async () => {
    const fixture = await readFile(FIXTURE_VIDEO);
    const detail = await api(test.app, learnerJar).get(
      `/api/learning/lessons/${seed.lessons[0]!.id}`,
    );
    expect(detail.status).toBe(200);
    const media = detail.body.content.media;
    expect(Object.keys(media).sort()).toEqual([
      'durationSeconds',
      'expiresAt',
      'fileName',
      'mimeType',
      'purpose',
      'sizeBytes',
      'url',
    ]);
    expect(media.purpose).toBe('stream');
    expect(media.sizeBytes).toBe(fixture.byteLength);
    expect(media.url).toMatch(
      /^\/api\/media\/content\?grant=[0-9a-f]{64}&purpose=stream&exp=\d+&sid=[0-9a-f]{12}&nonce=[0-9a-f]{32}&sig=[0-9a-f]{64}$/,
    );
    const ttl = Date.parse(media.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(240_000);
    expect(ttl).toBeLessThanOrEqual(300_000);
    const url = media.url as string;

    const full = await binaryGet(url, learnerJar);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toMatch(/video\/mp4/);
    expect(full.headers['cache-control']).toBe('no-store');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['content-disposition']).toMatch(/^inline;/);
    expect(Buffer.isBuffer(full.body)).toBe(true);
    expect(full.body.length).toBe(fixture.byteLength);
    expect(Buffer.compare(full.body as Buffer, fixture)).toBe(0);

    const ranged = await binaryGet(url, learnerJar, 'bytes=0-99');
    expect(ranged.status).toBe(206);
    expect(ranged.headers['content-range']).toBe(`bytes 0-99/${fixture.byteLength}`);
    expect((ranged.body as Buffer).length).toBe(100);
    expect(Buffer.compare(ranged.body as Buffer, fixture.subarray(0, 100))).toBe(0);

    const head = await request(test.app).head(url).set('Cookie', learnerJar.header());
    expect(head.status).toBe(200);
    expect(head.headers['accept-ranges']).toBe('bytes');
    expect(Number(head.headers['content-length'])).toBe(fixture.byteLength);

    const invalidRange = await request(test.app)
      .get(url)
      .set('Cookie', learnerJar.header())
      .set('Range', 'bytes=999999-');
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.body.error.code).toBe('invalid_range');
    expect(invalidRange.headers['content-range']).toBe(`bytes */${fixture.byteLength}`);

    // Altering the signed purpose must fail before any grant resolution.
    const tampered = url.replace('purpose=stream', 'purpose=download');
    const mismatch = await api(test.app, learnerJar).get(tampered);
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('media_signature_invalid');

    const unauthenticated = await request(test.app).get(url);
    expect(unauthenticated.status).toBe(401);

    const other = await register(test.app, { email: `media-other-${randomUUID().slice(0, 8)}@example.com` });
    const wrongUser = await api(test.app, other.jar).get(url);
    expect(wrongUser.status).toBe(403);
    // A different authenticated session has a different opaque signed-url reference.
    expect(wrongUser.body.error.code).toBe('media_session_mismatch');

    const refreshed = await api(test.app, learnerJar)
      .post(`/api/learning/lessons/${seed.lessons[0]!.id}/media`)
      .send({ purpose: 'stream' });
    expect(refreshed.status).toBe(200);
    const freshUrl = refreshed.body.media.url as string;

    await test.db.query(
      `UPDATE entitlements
          SET status = 'revoked', revoked_at = now(), revoked_reason = 'Phase 3 media authorization test'
        WHERE user_id = $1 AND course_id = $2`,
      [learnerId, seed.id],
    );
    const revoked = await api(test.app, learnerJar).get(freshUrl);
    expect(revoked.status).toBe(403);
    expect(revoked.body.error.code).toBe('entitlement_revoked');

    await test.db.query(
      `UPDATE entitlements
          SET status = 'active', revoked_at = NULL, revoked_reason = NULL
        WHERE user_id = $1 AND course_id = $2`,
      [learnerId, seed.id],
    );
    await test.db.query(
      `UPDATE media_asset_grants
          SET expires_at = now() - interval '1 second',
              created_at = now() - interval '1 hour'
        WHERE user_id = $1`,
      [learnerId],
    );
    const expired = await api(test.app, learnerJar).get(freshUrl);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('media_grant_expired');
  });
});
