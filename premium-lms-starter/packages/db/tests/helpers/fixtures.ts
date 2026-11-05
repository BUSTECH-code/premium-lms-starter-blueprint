import type { DbClient } from '../../src/client.js';
import { createUser } from '../../src/repos/users.js';

let counter = 0;

/** Creates a minimal active user for fixture rows. */
export async function makeUser(
  db: DbClient,
  options: { email?: string; name?: string } = {},
): Promise<{ id: string; email: string; name: string }> {
  counter += 1;
  const email = options.email ?? `fixture-${counter}-${Date.now()}@example.com`;
  const user = await createUser(db, {
    email,
    name: options.name ?? `Fixture User ${counter}`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixturefixturesalt$fixturehash',
    passwordAlgorithm: 'argon2id',
  });
  return { id: user.id, email: user.email, name: user.name };
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
  lessonsPerModule?: number;
}

/** Inserts a course with curriculum, price, tags and categories. */
export async function seedCourse(
  db: DbClient,
  options: SeedCourseOptions,
): Promise<{ id: string; slug: string; title: string }> {
  counter += 1;
  const slug = options.slug ?? `course-${counter}-${Date.now()}`;
  const title = options.title ?? `Course ${counter}`;

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
      options.summary ?? 'A summary for testing.',
      options.description ?? 'A full description for testing.',
      options.status ?? 'published',
      options.createdBy,
      options.priceAmount ?? '25000.00',
      options.priceCurrency ?? 'NGN',
      options.tags ?? ['test'],
    ],
  );
  const courseId = rows[0]?.id;
  if (!courseId) throw new Error('course seed failed');

  const { rows: moduleRows } = await db.query<{ id: string }>(
    `INSERT INTO modules (course_id, title, position) VALUES ($1, 'Module 1', 1) RETURNING id`,
    [courseId],
  );
  const moduleId = moduleRows[0]?.id;
  const lessonCount = options.lessonsPerModule ?? 2;
  for (let index = 0; index < lessonCount; index += 1) {
    await db.query(
      `INSERT INTO lessons (module_id, title, position, duration_seconds)
       VALUES ($1, $2, $3, $4)`,
      [moduleId, `Lesson ${index + 1}`, index + 1, 600 + index * 60],
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
