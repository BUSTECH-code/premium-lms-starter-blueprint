import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbClient } from '@lms/db';

let counter = 0;

/** Minimal fixture user (no login — for instructor/author rows). */
export async function makeFixtureUser(
  db: DbClient,
  options: { name?: string } = {},
): Promise<{ id: string; name: string }> {
  counter += 1;
  const name = options.name ?? `Fixture Instructor ${counter}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, 'hash', $2) RETURNING id`,
    [`fixture-${counter}-${Date.now()}@example.com`, name],
  );
  const row = rows[0];
  if (!row) throw new Error('fixture user insert failed');
  return { id: row.id, name };
}

export interface SeedCourseOptions {
  createdBy: string;
  status?: string;
  title?: string;
  slug?: string;
  summary?: string | null;
  description?: string | null;
  priceAmount?: string;
  priceCurrency?: string;
  tags?: string[];
  categories?: string[];
  lessonCount?: number;
}

/** Course + one module + lessons + optional categories (mirrors db fixtures). */
export async function seedCourse(
  db: DbClient,
  options: SeedCourseOptions,
): Promise<{ id: string; slug: string; title: string }> {
  counter += 1;
  const slug = options.slug ?? `course-${counter}-${Date.now()}`;
  const title = options.title ?? `Course ${counter}`;
  const status = options.status ?? 'published';

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO courses (slug, title, summary, description, status, created_by,
                          published_at, price_amount, price_currency, tags)
     VALUES ($1, $2, $3, $4, $5, $6,
             CASE WHEN $5 = 'published' THEN now() ELSE NULL END,
             $7, $8, $9::text[])
     RETURNING id`,
    [
      slug,
      title,
      options.summary ?? 'A catalogue summary for tests.',
      options.description ?? 'A full course description for tests.',
      status,
      options.createdBy,
      options.priceAmount ?? '25000.00',
      options.priceCurrency ?? 'NGN',
      options.tags ?? ['testing'],
    ],
  );
  const courseId = rows[0]?.id;
  if (!courseId) throw new Error('course seed failed');

  const { rows: moduleRows } = await db.query<{ id: string }>(
    `INSERT INTO modules (course_id, title, position) VALUES ($1, 'Foundations', 1) RETURNING id`,
    [courseId],
  );
  const moduleId = moduleRows[0]?.id;
  const lessonCount = options.lessonCount ?? 3;
  for (let index = 0; index < lessonCount; index += 1) {
    await db.query(
      `INSERT INTO lessons (module_id, title, position, duration_seconds)
       VALUES ($1, $2, $3, $4)`,
      [moduleId, `Lesson ${index + 1}`, index + 1, 300 + index * 120],
    );
  }

  for (const categorySlug of options.categories ?? []) {
    const { rows: catRows } = await db.query<{ id: string }>(
      `INSERT INTO categories (slug, name) VALUES ($1, $1)
       ON CONFLICT (slug) DO UPDATE SET name = categories.name
       RETURNING id`,
      [categorySlug],
    );
    await db.query(
      `INSERT INTO course_categories (course_id, category_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [courseId, catRows[0]?.id],
    );
  }

  return { id: courseId, slug, title };
}

/** Grant an entitlement directly (setup for visibility tests). */
export async function grantEntitlement(
  db: DbClient,
  userId: string,
  courseId: string,
  source = 'manual_grant',
): Promise<void> {
  await db.query(
    `INSERT INTO entitlements (user_id, course_id, source) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [userId, courseId, source],
  );
}

/** Enrol a learner (the enrolment trigger freezes the active criteria version). */
export async function enrollUser(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO enrollments (user_id, course_id, status) VALUES ($1, $2, 'active')
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [userId, courseId],
  );
}

/** Entitlement + enrolment, i.e. the state a verified purchase produces. */
export async function grantLearningAccess(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<void> {
  await grantEntitlement(db, userId, courseId);
  await enrollUser(db, userId, courseId);
}

const FIXTURE_DIR = fileURLToPath(new URL('../assets/fixtures', import.meta.url));

interface FixtureAssetIds {
  video: string;
  pdf: string;
}

async function ensureFixtureAssets(db: DbClient): Promise<FixtureAssetIds> {
  const specs = [
    {
      key: 'video' as const,
      reference: 'lesson-intro.mp4',
      mimeType: 'video/mp4',
      fileName: 'Lesson introduction (test fixture).mp4',
      durationSeconds: 4,
    },
    {
      key: 'pdf' as const,
      reference: 'lesson-notes.pdf',
      mimeType: 'application/pdf',
      fileName: 'Lesson notes (test fixture).pdf',
      durationSeconds: null,
    },
  ];
  const ids = {} as FixtureAssetIds;
  for (const spec of specs) {
    const bytes = await readFile(path.join(FIXTURE_DIR, spec.reference));
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO media_assets
         (provider, provider_reference, mime_type, file_name, file_size_bytes,
          checksum_sha256, duration_seconds, version)
       VALUES ('local_fixture', $1, $2, $3, $4, $5, $6, 1)
       ON CONFLICT (provider, provider_reference, version) DO UPDATE SET
         file_size_bytes = EXCLUDED.file_size_bytes,
         checksum_sha256 = EXCLUDED.checksum_sha256,
         updated_at = now()
       RETURNING id::text`,
      [
        spec.reference,
        spec.mimeType,
        spec.fileName,
        bytes.byteLength,
        checksum,
        spec.durationSeconds,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('fixture media insert failed');
    ids[spec.key] = id;
  }
  return ids;
}

export interface LearningLessonSeed {
  id: string;
  kind: 'video' | 'text' | 'quiz' | 'download';
  title: string;
}

export interface LearningCourseSeed {
  id: string;
  slug: string;
  title: string;
  lessons: LearningLessonSeed[];
  quizId: string;
  /** Server-side answer key for tests only — never exposed by the API. */
  correctAnswers: Record<string, string[]>;
  wrongAnswers: Record<string, string[]>;
  assetIds: FixtureAssetIds;
}

interface SeedLearningCourseOptions {
  createdBy: string;
  slug?: string;
  title?: string;
  priceAmount?: string;
  status?: string;
}

/**
 * A complete four-lesson course (video → text → quiz → download) across two
 * modules, with private local-fixture media and an objective quiz. Used by the
 * learning journey / state-machine / media-delivery tests.
 */
export async function seedLearningCourse(
  db: DbClient,
  options: SeedLearningCourseOptions,
): Promise<LearningCourseSeed> {
  counter += 1;
  const slug = options.slug ?? `learning-course-${counter}-${Date.now()}`;
  const title = options.title ?? `Learning Course ${counter}`;
  const status = options.status ?? 'published';
  const assets = await ensureFixtureAssets(db);

  const { rows: courseRows } = await db.query<{ id: string }>(
    `INSERT INTO courses (slug, title, summary, description, status, created_by,
                          published_at, price_amount, price_currency, tags)
     VALUES ($1, $2, $3, $4, $5, $6,
             CASE WHEN $5 = 'published' THEN now() ELSE NULL END,
             $7, 'NGN', '{"fixture"}'::text[])
     RETURNING id::text`,
    [
      slug,
      title,
      '[Test fixture] A learning engine course.',
      'Test fixture course for Phase 3 learning and progress tests.',
      status,
      options.createdBy,
      options.priceAmount ?? '25000.00',
    ],
  );
  const courseId = courseRows[0]?.id;
  if (!courseId) throw new Error('learning course seed failed');

  const moduleSpecs = [
    { title: 'Module one', position: 1 },
    { title: 'Module two', position: 2 },
  ];
  const moduleIds: string[] = [];
  for (const module of moduleSpecs) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO modules (course_id, title, position) VALUES ($1, $2, $3) RETURNING id::text`,
      [courseId, module.title, module.position],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('module seed failed');
    moduleIds.push(id);
  }

  const lessonSpecs: { title: string; kind: LearningLessonSeed['kind']; moduleIndex: number; position: number; duration: number }[] = [
    { title: 'Watch the introduction', kind: 'video', moduleIndex: 0, position: 1, duration: 4 },
    { title: 'Read the notes', kind: 'text', moduleIndex: 0, position: 2, duration: 180 },
    { title: 'Check your understanding', kind: 'quiz', moduleIndex: 1, position: 1, duration: 300 },
    { title: 'Download the companion PDF', kind: 'download', moduleIndex: 1, position: 2, duration: 120 },
  ];
  const lessons: LearningLessonSeed[] = [];
  for (const spec of lessonSpecs) {
    const moduleId = moduleIds[spec.moduleIndex];
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO lessons (module_id, title, position, duration_seconds, kind)
       VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
      [moduleId, spec.title, spec.position, spec.duration, spec.kind],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('lesson seed failed');
    lessons.push({ id, kind: spec.kind, title: spec.title });
  }

  const [videoLesson, textLesson, quizLesson, downloadLesson] = lessons;
  if (!videoLesson || !textLesson || !quizLesson || !downloadLesson) {
    throw new Error('lesson seed incomplete');
  }

  await db.query(
    `INSERT INTO lesson_content (lesson_id, asset_id) VALUES ($1, $2), ($3, $4)
     ON CONFLICT (lesson_id) DO NOTHING`,
    [videoLesson.id, assets.video, downloadLesson.id, assets.pdf],
  );
  await db.query(
    `INSERT INTO lesson_content (lesson_id, body_text) VALUES ($1, $2)
     ON CONFLICT (lesson_id) DO NOTHING`,
    [
      textLesson.id,
      '[Test fixture] Read these short notes. Opening or downloading content does not complete a lesson; use the explicit completion action.',
    ],
  );

  const { rows: quizRows } = await db.query<{ id: string }>(
    `INSERT INTO quizzes (lesson_id, title, instructions)
     VALUES ($1, 'Checkpoint', 'Test fixture quiz. Answer every question.')
     RETURNING id::text`,
    [quizLesson.id],
  );
  const quizId = quizRows[0]?.id;
  if (!quizId) throw new Error('quiz seed failed');

  const questions = [
    {
      position: 1,
      kind: 'single_choice',
      prompt: 'Which state is terminal for lesson progress?',
      choices: [
        { id: 'a', text: 'Not started', isCorrect: false },
        { id: 'b', text: 'In progress', isCorrect: false },
        { id: 'c', text: 'Completed', isCorrect: true },
      ],
    },
    {
      position: 2,
      kind: 'true_false',
      prompt: 'A download completes a lesson by itself.',
      choices: [
        { id: 'true', text: 'True', isCorrect: false },
        { id: 'false', text: 'False', isCorrect: true },
      ],
    },
    {
      position: 3,
      kind: 'multiple_choice',
      prompt: 'Select the approved completion actions.',
      choices: [
        { id: 'a', text: 'Explicit mark complete', isCorrect: true },
        { id: 'b', text: 'Passing a quiz', isCorrect: true },
        { id: 'c', text: 'Page visit', isCorrect: false },
        { id: 'd', text: 'Download', isCorrect: false },
      ],
    },
  ];
  const correctAnswers: Record<string, string[]> = {};
  const wrongAnswers: Record<string, string[]> = {};
  for (const question of questions) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO quiz_questions (quiz_id, position, kind, prompt, points, choices)
       VALUES ($1, $2, $3, $4, 1, $5::jsonb) RETURNING id::text`,
      [quizId, question.position, question.kind, question.prompt, JSON.stringify(question.choices)],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('quiz question seed failed');
    correctAnswers[id] = question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.id);
    wrongAnswers[id] = question.choices.filter((choice) => !choice.isCorrect).map((choice) => choice.id);
  }

  return { id: courseId, slug, title, lessons, quizId, correctAnswers, wrongAnswers, assetIds: assets };
}
