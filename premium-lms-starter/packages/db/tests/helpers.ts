import { expect } from 'vitest';
import { createDatabase, runMigrations, type DbClient } from '../src/index.js';

/** Fresh in-memory database with the full schema applied. */
export async function createTestDb(): Promise<DbClient> {
  const db = await createDatabase({ driver: 'pglite', path: 'memory:' });
  await runMigrations(db);
  return db;
}

/** Assert a rejected promise carries a specific PostgreSQL SQLSTATE code. */
export async function expectSqlError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { code?: string }).code;
    expect(actual).toBe(code);
    return;
  }
  throw new Error(`Expected SQL error ${code}, but the query succeeded`);
}

export interface FixtureUser {
  id: string;
  email: string;
}

export async function insertUser(
  db: DbClient,
  overrides: { email?: string; name?: string } = {},
): Promise<FixtureUser> {
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await db.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, name) VALUES ($1, 'hash', $2) RETURNING id, email`,
    [email, overrides.name ?? 'Test User'],
  );
  const row = rows[0];
  if (!row) throw new Error('fixture user insert failed');
  return row;
}

export async function insertCourse(
  db: DbClient,
  createdBy: string,
  overrides: { slug?: string; status?: string; publishedAt?: Date | null } = {},
): Promise<{ id: string; slug: string }> {
  const slug = overrides.slug ?? `course-${Math.random().toString(36).slice(2, 10)}`;
  const { rows } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO courses (slug, title, created_by, status, published_at)
     VALUES ($1, 'Test Course', $2, $3, $4) RETURNING id, slug`,
    [
      slug,
      createdBy,
      overrides.status ?? 'draft',
      overrides.publishedAt === undefined ? null : overrides.publishedAt,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('fixture course insert failed');
  return row;
}

export async function insertModule(
  db: DbClient,
  courseId: string,
  position = 1,
): Promise<{ id: string }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO modules (course_id, title, position) VALUES ($1, 'Module 1', $2) RETURNING id`,
    [courseId, position],
  );
  const row = rows[0];
  if (!row) throw new Error('fixture module insert failed');
  return row;
}

export async function insertLesson(
  db: DbClient,
  moduleId: string,
  position = 1,
): Promise<{ id: string }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO lessons (module_id, title, position) VALUES ($1, 'Lesson 1', $2) RETURNING id`,
    [moduleId, position],
  );
  const row = rows[0];
  if (!row) throw new Error('fixture lesson insert failed');
  return row;
}
