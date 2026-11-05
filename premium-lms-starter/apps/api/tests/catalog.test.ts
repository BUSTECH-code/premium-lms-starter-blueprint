import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, createTestApp, register, type TestApp } from './helpers.js';
import { grantEntitlement, makeFixtureUser, seedCourse } from './fixtures.js';

describe('course catalogue', () => {
  let test: TestApp;

  beforeEach(async () => {
    test = await createTestApp();
  });

  afterEach(async () => {
    await test.close();
  });

  it('lists published courses with price, curriculum stats and no invented fields', async () => {
    const instructor = await makeFixtureUser(test.db, { name: 'Ada Instructor' });
    await seedCourse(test.db, {
      createdBy: instructor.id,
      title: 'Node at Scale',
      slug: 'node-at-scale',
      tags: ['node', 'backend'],
      categories: ['engineering'],
      priceAmount: '45000.00',
    });
    await seedCourse(test.db, { createdBy: instructor.id, status: 'draft', title: 'Hidden Draft' });

    const res = await api(test.app).get('/api/courses');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);

    const item = res.body.items[0];
    expect(item.slug).toBe('node-at-scale');
    expect(item.href).toBe('/courses/node-at-scale');
    expect(item.price).toEqual({ amount: '45000.00', currency: 'NGN' });
    expect(item.instructor).toEqual({ name: 'Ada Instructor' });
    expect(item.categories).toEqual([{ slug: 'engineering', name: 'engineering' }]);
    expect(item.moduleCount).toBe(1);
    expect(item.lessonCount).toBe(3);
    expect(item.totalDurationSeconds).toBe('1260');
    // Never invent ratings, discounts or student counts.
    expect(item).not.toHaveProperty('rating');
    expect(item).not.toHaveProperty('reviews');
    expect(item).not.toHaveProperty('students');
    expect(item).not.toHaveProperty('discount');
    expect(item).not.toHaveProperty('oldPrice');
  });

  it('filters by search text, tag and category', async () => {
    const instructor = await makeFixtureUser(test.db);
    await seedCourse(test.db, {
      createdBy: instructor.id,
      slug: 'node-api-design',
      title: 'Node API Design',
      tags: ['node'],
      categories: ['engineering'],
    });
    await seedCourse(test.db, {
      createdBy: instructor.id,
      slug: 'watercolour-ways',
      title: 'Watercolour Ways',
      tags: ['art'],
      categories: ['art'],
    });

    const bySearch = await api(test.app).get('/api/courses?search=watercolour');
    expect(bySearch.body.items.map((c: { slug: string }) => c.slug)).toEqual(['watercolour-ways']);

    const byTag = await api(test.app).get('/api/courses?tag=node');
    expect(byTag.body.items.map((c: { slug: string }) => c.slug)).toEqual(['node-api-design']);

    const byCategory = await api(test.app).get('/api/courses?category=art');
    expect(byCategory.body.items.map((c: { slug: string }) => c.slug)).toEqual(['watercolour-ways']);
  });

  it('rejects malformed filter input', async () => {
    const res = await api(test.app).get('/api/courses?category=Bad%20Slug!');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('lists categories with published-course counts', async () => {
    const instructor = await makeFixtureUser(test.db);
    await seedCourse(test.db, { createdBy: instructor.id, categories: ['engineering'] });
    await seedCourse(test.db, {
      createdBy: instructor.id,
      status: 'draft',
      categories: ['engineering'],
    });

    const res = await api(test.app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ slug: 'engineering', courseCount: 1 }),
    ]);
  });

  it('serves the public course landing page with curriculum and instructor', async () => {
    const instructor = await makeFixtureUser(test.db, { name: 'Ada Instructor' });
    await seedCourse(test.db, {
      createdBy: instructor.id,
      slug: 'public-course',
      title: 'Public Course',
      categories: ['engineering'],
    });

    const res = await api(test.app).get('/api/courses/public-course');
    expect(res.status).toBe(200);
    const course = res.body.course;
    expect(course.title).toBe('Public Course');
    expect(course.status).toBe('published');
    expect(course.purchasable).toBe(true);
    expect(course.withdrawn).toBe(false);
    expect(course.access).toEqual({ entitled: false, entitlementStatus: null });
    expect(course.instructor).toMatchObject({ name: 'Ada Instructor', bio: null });
    expect(course.curriculum).toHaveLength(1);
    expect(course.curriculum[0].lessons).toHaveLength(3);
    expect(course.price).toEqual({ amount: '25000.00', currency: 'NGN' });
  });

  it('hides draft and withdrawn courses from anonymous visitors', async () => {
    const instructor = await makeFixtureUser(test.db);
    await seedCourse(test.db, { createdBy: instructor.id, status: 'draft', slug: 'draft-course' });
    await seedCourse(test.db, {
      createdBy: instructor.id,
      status: 'withdrawn',
      slug: 'withdrawn-course',
    });

    expect((await api(test.app).get('/api/courses/draft-course')).status).toBe(404);
    expect((await api(test.app).get('/api/courses/withdrawn-course')).status).toBe(404);
    expect((await api(test.app).get('/api/courses/does-not-exist')).status).toBe(404);
  });

  it('shows non-published course metadata to entitled learners (history preserved)', async () => {
    const instructor = await makeFixtureUser(test.db);
    const course = await seedCourse(test.db, {
      createdBy: instructor.id,
      status: 'withdrawn',
      slug: 'retired-course',
      title: 'Retired Course',
    });

    const { res: reg, jar } = await register(test.app, { email: 'learner@example.com' });
    expect(reg.status).toBe(201);
    await grantEntitlement(test.db, reg.body.user.id as string, course.id);

    const res = await api(test.app, jar).get('/api/courses/retired-course');
    expect(res.status).toBe(200);
    expect(res.body.course.status).toBe('withdrawn');
    expect(res.body.course.withdrawn).toBe(true);
    expect(res.body.course.purchasable).toBe(false);
    expect(res.body.course.access).toEqual({ entitled: true, entitlementStatus: 'active' });

    // Without the entitlement it stays hidden.
    const anonymous = await api(test.app).get('/api/courses/retired-course');
    expect(anonymous.status).toBe(404);
  });

  it('rejects invalid course slugs with a validation error', async () => {
    const res = await api(test.app).get('/api/courses/Bad%20Slug!');
    expect(res.status).toBe(400);
  });
});
