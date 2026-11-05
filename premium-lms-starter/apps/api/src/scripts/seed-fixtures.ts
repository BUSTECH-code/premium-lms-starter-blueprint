import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, runMigrations, type DbClient } from '@lms/db';
import { loadEnv } from '../config/env.js';

/**
 * Development fixture seeder: `npm run seed:fixtures` (workspace root).
 *
 * Clearly marked fixtures — every seeded course carries the `fixture` tag and
 * a "[Development fixture]" marker in its summary; the instructor account uses
 * the example.com domain. Idempotent: re-running never duplicates rows.
 * Not for staging/production (refuses to run outside development/test).
 */

const FIXTURE_TAG = 'fixture';
const MARKER = '[Development fixture]';

const CATEGORIES = [
  { slug: 'engineering', name: 'Engineering', description: 'Software craft and systems.' },
  { slug: 'design', name: 'Design', description: 'Visual and product design.' },
  { slug: 'business', name: 'Business', description: 'Operations and strategy.' },
  { slug: 'photography', name: 'Photography', description: 'Camera craft and light.' },
];

interface CourseFixture {
  slug: string;
  title: string;
  summary: string;
  description: string;
  status?: string;
  price: string;
  tags: string[];
  categories: string[];
  modules: { title: string; lessons: { title: string; duration: number }[] }[];
}

const COURSES: CourseFixture[] = [
  {
    slug: 'node-at-scale',
    title: 'Node at Scale',
    summary: `${MARKER} Design resilient services with queues, retries and clear boundaries.`,
    description:
      'A pragmatic tour of running Node.js services under real load.\n\nYou will model failure explicitly, back off correctly and keep operational dashboards honest.',
    price: '45000.00',
    tags: [FIXTURE_TAG, 'node', 'backend'],
    categories: ['engineering'],
    modules: [
      {
        title: 'Foundations of failure',
        lessons: [
          { title: 'Why services fail', duration: 540 },
          { title: 'Timeouts and budgets', duration: 720 },
          { title: 'Retries without storms', duration: 660 },
        ],
      },
      {
        title: 'Queues and back-pressure',
        lessons: [
          { title: 'Work queues in practice', duration: 780 },
          { title: 'Poison messages', duration: 600 },
          { title: 'Draining safely', duration: 690 },
        ],
      },
    ],
  },
  {
    slug: 'typescript-domain-modeling',
    title: 'TypeScript Domain Modeling',
    summary: `${MARKER} Encode business rules in types that make illegal states unrepresentable.`,
    description:
      'Move validation from runtime surprises to compile-time guarantees.\n\nBranded types, discriminated unions and honest nullability, applied to real order flows.',
    price: '35000.00',
    tags: [FIXTURE_TAG, 'typescript', 'backend'],
    categories: ['engineering'],
    modules: [
      {
        title: 'Modeling with types',
        lessons: [
          { title: 'Illegal states', duration: 600 },
          { title: 'Discriminated unions', duration: 720 },
          { title: 'Branded identifiers', duration: 540 },
        ],
      },
    ],
  },
  {
    slug: 'editorial-web-design',
    title: 'Editorial Web Design',
    summary: `${MARKER} Typographic hierarchy, deliberate whitespace and restrained colour.`,
    description:
      'Learn the discipline behind calm, premium interfaces.\n\nEvery decision — scale, rhythm, contrast — serves reading first.',
    price: '40000.00',
    tags: [FIXTURE_TAG, 'design', 'typography'],
    categories: ['design'],
    modules: [
      {
        title: 'Type and rhythm',
        lessons: [
          { title: 'Scale as hierarchy', duration: 660 },
          { title: 'Whitespace with intent', duration: 600 },
          { title: 'Colour restraint', duration: 540 },
        ],
      },
      {
        title: 'Layout patterns',
        lessons: [
          { title: 'Editorial rows vs cards', duration: 720 },
          { title: 'Responsive honesty', duration: 630 },
        ],
      },
    ],
  },
  {
    slug: 'product-positioning',
    title: 'Product Positioning',
    summary: `${MARKER} Say who it is for, what it replaces, and why now — in one page.`,
    description:
      'Positioning is a decision, not a tagline.\n\nInterview customers, frame the alternative and write a page your team can actually use.',
    price: '30000.00',
    tags: [FIXTURE_TAG, 'business', 'strategy'],
    categories: ['business'],
    modules: [
      {
        title: 'Finding the frame',
        lessons: [
          { title: 'Jobs and alternatives', duration: 720 },
          { title: 'Interviewing customers', duration: 840 },
          { title: 'The one-page narrative', duration: 660 },
        ],
      },
    ],
  },
  {
    slug: 'available-light-photography',
    title: 'Available Light Photography',
    summary: `${MARKER} Read light before you read settings — windows, shade and golden hour.`,
    description:
      'Train your eye for the light that already exists.\n\nPractical exercises with a single lens and no studio gear.',
    price: '25000.00',
    tags: [FIXTURE_TAG, 'photography'],
    categories: ['photography'],
    modules: [
      {
        title: 'Seeing light',
        lessons: [
          { title: 'Direction and quality', duration: 600 },
          { title: 'Window light studies', duration: 720 },
          { title: 'Golden hour discipline', duration: 540 },
        ],
      },
    ],
  },
  {
    slug: 'running-safe-migrations',
    title: 'Running Safe Migrations',
    summary: `${MARKER} Expand, migrate, contract — ship schema changes without downtime.`,
    description:
      'Schema changes fail in interesting ways under load.\n\nPlan rollouts, verify constraints and keep history tables honest.',
    price: '28000.00',
    tags: [FIXTURE_TAG, 'databases', 'engineering'],
    categories: ['engineering'],
    modules: [
      {
        title: 'Migration discipline',
        lessons: [
          { title: 'Expand and contract', duration: 660 },
          { title: 'Backfills that finish', duration: 720 },
          { title: 'Verifying in production', duration: 600 },
        ],
      },
    ],
  },
  {
    slug: 'draft-design-system-audit',
    title: 'Design System Audit (draft)',
    summary: `${MARKER} Unpublished draft — exercises catalogue filtering for drafts.`,
    description: 'This course intentionally stays in draft status.',
    status: 'draft',
    price: '0.00',
    tags: [FIXTURE_TAG, 'design'],
    categories: ['design'],
    modules: [
      {
        title: 'Audit method',
        lessons: [{ title: 'Inventory', duration: 300 }],
      },
    ],
  },
  {
    slug: 'retired-flash-techniques',
    title: 'Retired Flash Techniques',
    summary: `${MARKER} Withdrawn course — proves withdrawal rules (hidden from buyers, history kept).`,
    description: 'This course is intentionally withdrawn.',
    status: 'withdrawn',
    price: '15000.00',
    tags: [FIXTURE_TAG, 'design'],
    categories: ['design'],
    modules: [
      {
        title: 'History',
        lessons: [{ title: 'What we learned', duration: 300 }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Phase 3 learning fixtures (approved Q1 local_authorized_fixtures)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = fileURLToPath(new URL('../../assets/fixtures', import.meta.url));
const LESSON_KINDS = ['video', 'text', 'quiz', 'download'] as const;
type FixtureLessonKind = (typeof LESSON_KINDS)[number];

interface FixtureMedia {
  key: 'video' | 'pdf';
  reference: string;
  mimeType: string;
  fileName: string;
  durationSeconds: number | null;
}

const FIXTURE_MEDIA: FixtureMedia[] = [
  {
    key: 'video',
    reference: 'lesson-intro.mp4',
    mimeType: 'video/mp4',
    fileName: 'Lesson introduction (development fixture).mp4',
    durationSeconds: 4,
  },
  {
    key: 'pdf',
    reference: 'lesson-notes.pdf',
    mimeType: 'application/pdf',
    fileName: 'Lesson notes (development fixture).pdf',
    durationSeconds: null,
  },
];

interface FixtureQuizQuestion {
  position: number;
  kind: 'single_choice' | 'multiple_choice' | 'true_false';
  prompt: string;
  choices: { id: string; text: string; isCorrect: boolean }[];
}

const QUIZ_QUESTIONS: FixtureQuizQuestion[] = [
  {
    position: 1,
    kind: 'single_choice',
    prompt: 'Which progress state means a lesson has never been opened?',
    choices: [
      { id: 'a', text: 'Not started', isCorrect: true },
      { id: 'b', text: 'In progress', isCorrect: false },
      { id: 'c', text: 'Completed', isCorrect: false },
    ],
  },
  {
    position: 2,
    kind: 'single_choice',
    prompt: 'What completes an ordinary video, text or download lesson under the approved rule?',
    choices: [
      { id: 'a', text: 'Opening the page', isCorrect: false },
      { id: 'b', text: 'Downloading a file', isCorrect: false },
      { id: 'c', text: 'An explicit “Mark complete” action', isCorrect: true },
      { id: 'd', text: 'Reaching 90% watched automatically', isCorrect: false },
    ],
  },
  {
    position: 3,
    kind: 'multiple_choice',
    prompt: 'Select all lesson kinds supported by this fixture player.',
    choices: [
      { id: 'a', text: 'Video', isCorrect: true },
      { id: 'b', text: 'Text', isCorrect: true },
      { id: 'c', text: 'Quiz', isCorrect: true },
      { id: 'd', text: 'Download', isCorrect: true },
      { id: 'e', text: 'Live tutoring', isCorrect: false },
    ],
  },
  {
    position: 4,
    kind: 'true_false',
    prompt: 'A downloaded lesson is automatically a completed lesson.',
    choices: [
      { id: 'true', text: 'True', isCorrect: false },
      { id: 'false', text: 'False', isCorrect: true },
    ],
  },
  {
    position: 5,
    kind: 'single_choice',
    prompt: 'What happens when an older offline progress event arrives after newer progress?',
    choices: [
      { id: 'a', text: 'It overwrites the newer state', isCorrect: false },
      { id: 'b', text: 'It is ignored as stale', isCorrect: true },
      { id: 'c', text: 'It unlocks every lesson', isCorrect: false },
      { id: 'd', text: 'It deletes server progress', isCorrect: false },
    ],
  },
];

interface LessonSeedRow {
  id: string;
  kind: string;
  lesson_title: string;
  has_content: boolean;
  has_quiz: boolean;
}

async function ensureMediaAssets(db: DbClient): Promise<Record<FixtureMedia['key'], string>> {
  const ids = {} as Record<FixtureMedia['key'], string>;
  for (const media of FIXTURE_MEDIA) {
    const bytes = await readFile(path.join(FIXTURE_DIR, media.reference));
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO media_assets
         (provider, provider_reference, mime_type, file_name, file_size_bytes,
          checksum_sha256, duration_seconds, version)
       VALUES ('local_fixture', $1, $2, $3, $4, $5, $6, 1)
       ON CONFLICT (provider, provider_reference, version) DO UPDATE SET
         mime_type = EXCLUDED.mime_type,
         file_name = EXCLUDED.file_name,
         file_size_bytes = EXCLUDED.file_size_bytes,
         checksum_sha256 = EXCLUDED.checksum_sha256,
         duration_seconds = EXCLUDED.duration_seconds,
         updated_at = now()
       RETURNING id::text`,
      [
        media.reference,
        media.mimeType,
        media.fileName,
        bytes.byteLength,
        checksum,
        media.durationSeconds,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`Could not seed media fixture ${media.reference}`);
    ids[media.key] = id;
  }
  return ids;
}

async function ensureQuizQuestions(db: DbClient, quizId: string): Promise<void> {
  for (const question of QUIZ_QUESTIONS) {
    await db.query(
      `INSERT INTO quiz_questions (quiz_id, position, kind, prompt, points, choices)
       VALUES ($1, $2, $3, $4, 1, $5::jsonb)
       ON CONFLICT (quiz_id, position) DO NOTHING`,
      [quizId, question.position, question.kind, question.prompt, JSON.stringify(question.choices)],
    );
  }
}

/** Assign a deterministic mix of the four approved lesson kinds + content. */
async function seedLearningContent(db: DbClient): Promise<number> {
  const mediaIds = await ensureMediaAssets(db);
  const { rows } = await db.query<LessonSeedRow>(
    `SELECT l.id::text, l.kind, l.title AS lesson_title,
            EXISTS (SELECT 1 FROM lesson_content lc WHERE lc.lesson_id = l.id) AS has_content,
            EXISTS (SELECT 1 FROM quizzes q WHERE q.lesson_id = l.id) AS has_quiz
       FROM lessons l JOIN modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
      ORDER BY c.slug, m.position, l.position`,
  );

  let configured = 0;
  for (const [index, lesson] of rows.entries()) {
    const kind: FixtureLessonKind = LESSON_KINDS[index % LESSON_KINDS.length] ?? 'video';
    if (lesson.has_content || lesson.has_quiz) continue;

    if (lesson.kind !== kind) {
      // The schema forbids changing a lesson kind after content exists; these
      // rows have neither content nor a quiz, so the assignment is safe.
      await db.query('UPDATE lessons SET kind = $2 WHERE id = $1', [lesson.id, kind]);
    }

    if (kind === 'video' || kind === 'download') {
      await db.query(
        `INSERT INTO lesson_content (lesson_id, asset_id) VALUES ($1, $2)
         ON CONFLICT (lesson_id) DO NOTHING`,
        [lesson.id, kind === 'video' ? mediaIds.video : mediaIds.pdf],
      );
    } else if (kind === 'text') {
      await db.query(
        `INSERT INTO lesson_content (lesson_id, body_text) VALUES ($1, $2)
         ON CONFLICT (lesson_id) DO NOTHING`,
        [
          lesson.id,
          `[Development fixture] ${lesson.lesson_title}\n\n` +
            'These notes are a local fixture for the learning player. They contain no real ' +
            'course material. Read them, then mark the lesson complete when you are ready.',
        ],
      );
    } else {
      const { rows: quizRows } = await db.query<{ id: string }>(
        `INSERT INTO quizzes (lesson_id, title, instructions)
         VALUES ($1, $2, $3)
         ON CONFLICT (lesson_id) DO NOTHING RETURNING id::text`,
        [
          lesson.id,
          `Checkpoint: ${lesson.lesson_title}`,
          'Development fixture quiz. Objective questions are auto-graded; the passing score comes from your frozen course completion rules.',
        ],
      );
      let quizId = quizRows[0]?.id;
      if (!quizId) {
        const { rows: existing } = await db.query<{ id: string }>(
          'SELECT id::text FROM quizzes WHERE lesson_id = $1',
          [lesson.id],
        );
        quizId = existing[0]?.id;
      }
      if (!quizId) throw new Error('Quiz fixture insert failed');
      await ensureQuizQuestions(db, quizId);
    }
    configured += 1;
  }

  // Repair any earlier fixture quiz that has a row but no questions.
  const { rows: emptyQuizzes } = await db.query<{ id: string }>(
    `SELECT q.id::text FROM quizzes q
      WHERE NOT EXISTS (SELECT 1 FROM quiz_questions qq WHERE qq.quiz_id = q.id)`,
  );
  for (const quiz of emptyQuizzes) await ensureQuizQuestions(db, quiz.id);

  return configured;
}

async function seed(
  db: DbClient,
): Promise<{ courses: number; categories: number; learningLessons: number }> {
  // Instructor account (fixture marker in the email domain; not a real person).
  await db.query(
    `INSERT INTO users (email, password_hash, name, bio)
     VALUES ($1, 'fixture-only-not-loginable', $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [
      'fixture-instructor@example.com',
      'Fixture Instructor',
      'Teaches the seeded development courses. Fixture account — not a real instructor.',
    ],
  );
  const { rows: instructorRows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE email = 'fixture-instructor@example.com'`,
  );
  const instructorId = instructorRows[0]?.id;
  if (!instructorId) throw new Error('fixture instructor missing');

  let categories = 0;
  for (const category of CATEGORIES) {
    const result = await db.query(
      `INSERT INTO categories (slug, name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO NOTHING`,
      [category.slug, category.name, category.description],
    );
    categories += result.rowCount ?? 0;
  }

  let courses = 0;
  for (const fixture of COURSES) {
    const { rows: existing } = await db.query<{ id: string }>(
      'SELECT id FROM courses WHERE slug = $1',
      [fixture.slug],
    );
    if (existing[0]) continue;

    const status = fixture.status ?? 'published';
    const { rows: courseRows } = await db.query<{ id: string }>(
      `INSERT INTO courses (slug, title, summary, description, status, created_by,
                            published_at, price_amount, price_currency, tags)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $5 = 'published' THEN now() ELSE NULL END,
               $7, 'NGN', $8::text[])
       RETURNING id`,
      [
        fixture.slug,
        fixture.title,
        fixture.summary,
        fixture.description,
        status,
        instructorId,
        fixture.price,
        fixture.tags,
      ],
    );
    const courseId = courseRows[0]?.id;
    if (!courseId) throw new Error(`seed failed for ${fixture.slug}`);

    for (const [moduleIndex, moduleFixture] of fixture.modules.entries()) {
      const { rows: moduleRows } = await db.query<{ id: string }>(
        `INSERT INTO modules (course_id, title, position) VALUES ($1, $2, $3) RETURNING id`,
        [courseId, moduleFixture.title, moduleIndex + 1],
      );
      const moduleId = moduleRows[0]?.id;
      for (const [lessonIndex, lessonFixture] of moduleFixture.lessons.entries()) {
        await db.query(
          `INSERT INTO lessons (module_id, title, position, duration_seconds)
           VALUES ($1, $2, $3, $4)`,
          [moduleId, lessonFixture.title, lessonIndex + 1, lessonFixture.duration],
        );
      }
    }

    for (const categorySlug of fixture.categories) {
      await db.query(
        `INSERT INTO course_categories (course_id, category_id)
         SELECT $1, id FROM categories WHERE slug = $2
         ON CONFLICT DO NOTHING`,
        [courseId, categorySlug],
      );
    }
    courses += 1;
  }

  // Learning content is seeded for both new and pre-existing courses, so an
  // upgraded development database gains a working player without data loss.
  const learningLessons = await seedLearningContent(db);

  if (courses > 0 || learningLessons > 0) {
    await db.query(
      `INSERT INTO audit_events (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'fixtures.seeded', 'course', NULL, $2::jsonb)`,
      [
        instructorId,
        JSON.stringify({
          courses,
          categories,
          learningLessons,
          lessonKinds: LESSON_KINDS,
          mediaProvider: 'local_fixture',
          marker: MARKER,
          note: 'Development fixtures only — safe to delete.',
        }),
      ],
    );
  }

  return { courses, categories, learningLessons };
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.nodeEnv === 'staging' || env.nodeEnv === 'production') {
    throw new Error('Refusing to seed fixtures outside development/test.');
  }
  const db = await createDatabase({ driver: env.db.driver, path: env.db.path });
  try {
    await runMigrations(db);
    const result = await seed(db);
    process.stdout.write(
      `Seeded ${result.courses} new course fixture(s), ${result.categories} new categorie(s), ` +
        `${result.learningLessons} learning lesson(s).\n`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
