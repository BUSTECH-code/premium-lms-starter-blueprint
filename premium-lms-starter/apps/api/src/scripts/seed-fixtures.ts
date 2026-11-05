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

async function seed(db: DbClient): Promise<{ courses: number; categories: number }> {
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

  if (courses > 0) {
    await db.query(
      `INSERT INTO audit_events (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'fixtures.seeded', 'course', NULL, $2::jsonb)`,
      [
        instructorId,
        JSON.stringify({
          courses,
          categories,
          marker: MARKER,
          note: 'Development fixtures only — safe to delete.',
        }),
      ],
    );
  }

  return { courses, categories };
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
      `Seeded ${result.courses} new course fixture(s), ${result.categories} new categorie(s).\n`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
