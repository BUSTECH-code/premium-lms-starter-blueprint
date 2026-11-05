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
