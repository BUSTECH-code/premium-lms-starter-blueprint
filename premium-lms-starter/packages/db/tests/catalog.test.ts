import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers.js';
import { makeUser, seedCourse } from './helpers/fixtures.js';
import {
  getCourseBySlug,
  getCurriculum,
  listCategories,
  listPublishedCourses,
} from '../src/repos/catalog.js';
import type { DbClient } from '../src/client.js';

describe('migration 0003 — catalogue & checkout columns', () => {
  let db: DbClient;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it('adds users.bio, course price/tags and order expiry', async () => {
    const user = await makeUser(db, { name: 'Bio User' });

    const { rows: bioRows } = await db.query<{ bio: string | null }>(
      'SELECT bio FROM users WHERE id = $1',
      [user.id],
    );
    expect(bioRows[0]).toBeDefined();
    expect(bioRows[0]?.bio).toBeNull();

    // Prices must be supplied explicitly (no silent default).
    await expect(
      db.query(
        `INSERT INTO courses (slug, title, status, created_by)
         VALUES ('no-price', 'No Price', 'draft', $1)`,
        [user.id],
      ),
    ).rejects.toThrow(/price_amount/);

    // Tags default to empty; order expiry column exists.
    const { rows: tagRows } = await db.query<{ tags: string[] }>(
      `INSERT INTO courses (slug, title, status, created_by, price_amount, price_currency)
       VALUES ('tagged', 'Tagged', 'draft', $1, '0.00', 'NGN') RETURNING tags`,
      [user.id],
    );
    expect(tagRows[0]?.tags).toEqual([]);

    const { rows: indexRows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'orders' AND indexname = 'orders_checkout_expiry_idx'`,
    );
    expect(indexRows.length).toBe(1);
  });

  it('rejects negative prices and malformed currencies', async () => {
    const user = await makeUser(db);
    await expect(
      db.query(
        `INSERT INTO courses (slug, title, status, created_by, price_amount, price_currency)
         VALUES ('bad-price', 'Bad', 'draft', $1, '-5.00', 'NGN')`,
        [user.id],
      ),
    ).rejects.toThrow(/courses_price_amount_non_negative/);
    await expect(
      db.query(
        `INSERT INTO courses (slug, title, status, created_by, price_amount, price_currency)
         VALUES ('bad-currency', 'Bad', 'draft', $1, '10.00', 'usd')`,
        [user.id],
      ),
    ).rejects.toThrow(/courses_price_currency_format/);
  });
});

describe('catalogue repository', () => {
  let db: DbClient;
  let instructor: { id: string; name: string };
  let other: { id: string };

  beforeEach(async () => {
    db = await createTestDb();
    instructor = await makeUser(db, { name: 'Ada Instructor' });
    other = await makeUser(db, { name: 'Other Author' });
  });

  it('lists only published courses with curriculum counts', async () => {
    await seedCourse(db, {
      createdBy: instructor.id,
      title: 'Published Course',
      slug: 'published-course',
      tags: ['node'],
      categories: ['engineering'],
    });
    await seedCourse(db, {
      createdBy: instructor.id,
      title: 'Draft Course',
      status: 'draft',
      slug: 'draft-course',
    });
    await seedCourse(db, {
      createdBy: instructor.id,
      title: 'Withdrawn Course',
      status: 'withdrawn',
      slug: 'withdrawn-course',
    });

    const listed = await listPublishedCourses(db, { limit: 20, offset: 0 });
    expect(listed.total).toBe(1);
    expect(listed.items.map((c) => c.slug)).toEqual(['published-course']);
    expect(listed.items[0]?.module_count).toBe(1);
    expect(listed.items[0]?.lesson_count).toBe(2);
    expect(listed.items[0]?.total_duration_seconds).toBe('1260');
    expect(listed.items[0]?.instructor_name).toBe('Ada Instructor');
    expect(listed.items[0]?.categories).toEqual([{ slug: 'engineering', name: 'engineering' }]);
    expect(listed.items[0]?.price_amount).toBe('25000.00');
    expect(listed.items[0]?.price_currency).toBe('NGN');
  });

  it('filters by search (title/instructor/tag), category and tag', async () => {
    await seedCourse(db, {
      createdBy: instructor.id,
      title: 'Node Fundamentals',
      slug: 'node-fundamentals',
      tags: ['backend', 'node'],
      categories: ['engineering'],
    });
    await seedCourse(db, {
      createdBy: other.id,
      title: 'Watercolour Basics',
      slug: 'watercolour-basics',
      tags: ['art'],
      categories: ['art'],
    });

    const byTitle = await listPublishedCourses(db, { limit: 20, offset: 0, search: 'node' });
    expect(byTitle.items.map((c) => c.slug)).toEqual(['node-fundamentals']);

    const byInstructor = await listPublishedCourses(db, {
      limit: 20,
      offset: 0,
      search: 'Ada Instructor',
    });
    expect(byInstructor.items.map((c) => c.slug)).toEqual(['node-fundamentals']);

    const byTagWord = await listPublishedCourses(db, { limit: 20, offset: 0, search: 'backend' });
    expect(byTagWord.items.map((c) => c.slug)).toEqual(['node-fundamentals']);

    const byCategory = await listPublishedCourses(db, {
      limit: 20,
      offset: 0,
      category: 'art',
    });
    expect(byCategory.items.map((c) => c.slug)).toEqual(['watercolour-basics']);

    const byTag = await listPublishedCourses(db, { limit: 20, offset: 0, tag: 'backend' });
    expect(byTag.items.map((c) => c.slug)).toEqual(['node-fundamentals']);
  });

  it('paginates with a stable total', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedCourse(db, { createdBy: instructor.id, title: `Course ${i}` });
    }
    const page1 = await listPublishedCourses(db, { limit: 2, offset: 0 });
    const page2 = await listPublishedCourses(db, { limit: 2, offset: 2 });
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    const slugs = new Set([...page1.items, ...page2.items].map((c) => c.slug));
    expect(slugs.size).toBe(4);
  });

  it('returns any-status detail by slug and ordered curriculum', async () => {
    const course = await seedCourse(db, {
      createdBy: instructor.id,
      status: 'withdrawn',
      slug: 'retired-course',
      title: 'Retired Course',
      description: 'Old description',
    });

    const detail = await getCourseBySlug(db, 'retired-course');
    expect(detail?.status).toBe('withdrawn');
    expect(detail?.description).toBe('Old description');
    expect(detail?.instructor_bio).toBeNull();

    const curriculum = await getCurriculum(db, course.id);
    expect(curriculum).toHaveLength(1);
    expect(curriculum[0]?.title).toBe('Module 1');
    expect(curriculum[0]?.lessons.map((l) => l.title)).toEqual(['Lesson 1', 'Lesson 2']);
    expect(curriculum[0]?.lessons[0]?.duration_seconds).toBe('600.00');

    expect(await getCourseBySlug(db, 'missing-course')).toBeNull();
  });

  it('category list counts published courses only', async () => {
    await seedCourse(db, {
      createdBy: instructor.id,
      categories: ['engineering'],
      title: 'Pub eng',
    });
    await seedCourse(db, {
      createdBy: instructor.id,
      status: 'draft',
      categories: ['engineering'],
      title: 'Draft eng',
    });
    await seedCourse(db, { createdBy: instructor.id, categories: ['art'], title: 'Art pub' });

    const categories = await listCategories(db);
    expect(categories.map((c) => [c.slug, c.course_count])).toEqual([
      ['art', 1],
      ['engineering', 1],
    ]);
  });

  it('concurrent-safe read shape: DbClient accepts a transaction client', async () => {
    const course = await seedCourse(db, { createdBy: instructor.id });
    await db.transaction(async (tx: DbClient) => {
      const rows = await listPublishedCourses(tx, { limit: 1, offset: 0 });
      expect(rows.items.some((c) => c.id === course.id)).toBe(true);
    });
  });
});
