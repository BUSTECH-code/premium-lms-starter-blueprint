import { afterEach, describe, expect, it } from 'vitest';
import type { DbClient } from '../src/index.js';
import {
  createTestDb,
  expectSqlError,
  insertCourse,
  insertLesson,
  insertModule,
  insertUser,
} from './helpers.js';

let db: DbClient;

afterEach(async () => {
  await db?.close().catch(() => undefined);
});

describe('users table constraints', () => {
  it('rejects duplicate emails (unique)', async () => {
    db = await createTestDb();
    await insertUser(db, { email: 'dup@example.com' });
    await expectSqlError(insertUser(db, { email: 'dup@example.com' }), '23505');
  });

  it('rejects non-normalised emails and malformed emails (check)', async () => {
    db = await createTestDb();
    await expectSqlError(
      db.query(
        `INSERT INTO users (email, password_hash, name) VALUES ('Mixed@Case.com', 'h', 'n')`,
      ),
      '23514',
    );
    await expectSqlError(
      db.query(`INSERT INTO users (email, password_hash, name) VALUES ('not-an-email', 'h', 'n')`),
      '23514',
    );
  });

  it('rejects blank or oversized names (check)', async () => {
    db = await createTestDb();
    await expectSqlError(
      db.query(`INSERT INTO users (email, password_hash, name) VALUES ('a@b.co', 'h', '   ')`),
      '23514',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO users (email, password_hash, name) VALUES ('a@b.co', 'h', repeat('x', 121))`,
      ),
      '23514',
    );
  });

  it('rejects unknown account statuses (check)', async () => {
    db = await createTestDb();
    await expectSqlError(
      db.query(
        `INSERT INTO users (email, password_hash, name, status) VALUES ('s@b.co', 'h', 'n', 'deleted')`,
      ),
      '23514',
    );
  });
});

describe('RBAC tables', () => {
  it('enforces foreign keys on user_roles', async () => {
    db = await createTestDb();
    const user = await insertUser(db);
    await expectSqlError(
      db.query(
        `INSERT INTO user_roles (user_id, role_key) VALUES ('00000000-0000-0000-0000-000000000000', 'student')`,
      ),
      '23503',
    );
    await expectSqlError(
      db.query(`INSERT INTO user_roles (user_id, role_key) VALUES ($1, 'superuser')`, [user.id]),
      '23503',
    );
  });

  it('rejects roles outside the approved set (check)', async () => {
    db = await createTestDb();
    await expectSqlError(
      db.query(`INSERT INTO roles (key, name) VALUES ('superuser', 'Superuser')`),
      '23514',
    );
  });
});

describe('course structure constraints', () => {
  it('validates slug, status and published timestamp (checks)', async () => {
    db = await createTestDb();
    const author = await insertUser(db);

    await expectSqlError(
      db.query(
        `INSERT INTO courses (slug, title, created_by) VALUES ('Bad Slug!', 'Course', $1)`,
        [author.id],
      ),
      '23514',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO courses (slug, title, created_by, status) VALUES ('good-slug', 'Course', $1, 'live')`,
        [author.id],
      ),
      '23514',
    );
    // published without a published_at timestamp is not allowed
    await expectSqlError(
      db.query(
        `INSERT INTO courses (slug, title, created_by, status) VALUES ('pub-course', 'Course', $1, 'published')`,
        [author.id],
      ),
      '23514',
    );
  });

  it('restricts deleting a user who owns courses', async () => {
    db = await createTestDb();
    const author = await insertUser(db);
    await insertCourse(db, author.id);
    await expectSqlError(db.query('DELETE FROM users WHERE id = $1', [author.id]), '23001');
  });

  it('enforces unique module/lesson positions and cascades structural children', async () => {
    db = await createTestDb();
    const author = await insertUser(db);
    const course = await insertCourse(db, author.id);
    const module = await insertModule(db, course.id, 1);

    await expectSqlError(insertModule(db, course.id, 1), '23505'); // duplicate position
    await expectSqlError(
      db.query(`INSERT INTO modules (course_id, title, position) VALUES ($1, 'M', 0)`, [course.id]),
      '23514',
    );
    await insertLesson(db, module.id, 1);
    await expectSqlError(insertLesson(db, module.id, 1), '23505'); // duplicate position
    await expectSqlError(
      db.query(`INSERT INTO lessons (module_id, title, position) VALUES ($1, 'L', 0)`, [module.id]),
      '23514',
    );

    // no progress yet → structural delete cascades modules and lessons
    await db.query('DELETE FROM courses WHERE id = $1', [course.id]);
    const { rows: remaining } = await db.query(
      'SELECT id FROM modules WHERE id = $1',
      [module.id],
    );
    expect(remaining).toHaveLength(0);
  });
});

describe('enrolments', () => {
  it('enforces one enrolment per user/course and valid statuses', async () => {
    db = await createTestDb();
    const user = await insertUser(db);
    const other = await insertUser(db);
    const course = await insertCourse(db, other.id);

    await db.query(`INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)`, [
      user.id,
      course.id,
    ]);
    await expectSqlError(
      db.query(`INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)`, [
        user.id,
        course.id,
      ]),
      '23505',
    );
    await expectSqlError(
      db.query(`INSERT INTO enrollments (user_id, course_id, status) VALUES ($1, $2, 'paused')`, [
        user.id,
        course.id,
      ]),
      '23514',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO enrollments (user_id, course_id, status) VALUES ($1, $2, 'completed')`,
        [user.id, course.id],
      ),
      '23514', // completed requires completed_at
    );
  });

  it('restricts deleting users/courses that have enrolment history', async () => {
    db = await createTestDb();
    const owner = await insertUser(db);
    const learner = await insertUser(db);
    const course = await insertCourse(db, owner.id);
    await db.query(`INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)`, [
      learner.id,
      course.id,
    ]);
    await expectSqlError(db.query('DELETE FROM users WHERE id = $1', [learner.id]), '23001');
    await expectSqlError(db.query('DELETE FROM courses WHERE id = $1', [course.id]), '23001');
  });
});

describe('progress tracking', () => {
  it('enforces unique user/lesson progress, bounds and completion metadata', async () => {
    db = await createTestDb();
    const owner = await insertUser(db);
    const learner = await insertUser(db);
    const course = await insertCourse(db, owner.id);
    const module = await insertModule(db, course.id);
    const lesson = await insertLesson(db, module.id);

    await db.query(
      `INSERT INTO lesson_progress (user_id, lesson_id, status, progress_percent)
       VALUES ($1, $2, 'in_progress', 40)`,
      [learner.id, lesson.id],
    );
    await expectSqlError(
      db.query(`INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1, $2)`, [
        learner.id,
        lesson.id,
      ]),
      '23505',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO lesson_progress (user_id, lesson_id, progress_percent) VALUES ($1, $2, 101)`,
        [learner.id, lesson.id],
      ),
      '23514',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO lesson_progress (user_id, lesson_id, status) VALUES ($1, $2, 'completed')`,
        [learner.id, lesson.id],
      ),
      '23514', // completed requires completed_at
    );
  });

  it('never cascade-deletes progress and blocks lesson deletion while progress exists', async () => {
    db = await createTestDb();
    const owner = await insertUser(db);
    const learner = await insertUser(db);
    const course = await insertCourse(db, owner.id);
    const module = await insertModule(db, course.id);
    const lesson = await insertLesson(db, module.id);
    await db.query(
      `INSERT INTO lesson_progress (user_id, lesson_id, status, completed_at)
       VALUES ($1, $2, 'completed', now())`,
      [learner.id, lesson.id],
    );

    await expectSqlError(db.query('DELETE FROM lessons WHERE id = $1', [lesson.id]), '23001');
    await expectSqlError(db.query('DELETE FROM modules WHERE id = $1', [module.id]), '23001');
    await expectSqlError(db.query('DELETE FROM courses WHERE id = $1', [course.id]), '23001');
    await expectSqlError(db.query('DELETE FROM users WHERE id = $1', [learner.id]), '23001');
  });
});

describe('commerce tables (orders, payments, payment events)', () => {
  it('validates order status, currency and non-negative amounts', async () => {
    db = await createTestDb();
    const user = await insertUser(db);

    await expectSqlError(
      db.query(
        `INSERT INTO orders (user_id, currency, total_amount) VALUES ($1, 'usd', 10)`,
        [user.id],
      ),
      '23514',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO orders (user_id, currency, total_amount) VALUES ($1, 'NGN', -1)`,
        [user.id],
      ),
      '23514',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO orders (user_id, currency, total_amount, status) VALUES ($1, 'NGN', 10, 'shipped')`,
        [user.id],
      ),
      '23514',
    );
    await db.query(`INSERT INTO orders (user_id, currency, total_amount, idempotency_key) VALUES ($1, 'NGN', 10, 'idem-1')`, [user.id]);
    await expectSqlError(
      db.query(
        `INSERT INTO orders (user_id, currency, total_amount, idempotency_key) VALUES ($1, 'NGN', 10, 'idem-1')`,
        [user.id],
      ),
      '23505',
    );
  });

  it('validates order items and cascades them with their order', async () => {
    db = await createTestDb();
    const owner = await insertUser(db);
    const buyer = await insertUser(db);
    const course = await insertCourse(db, owner.id);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO orders (user_id, currency, total_amount) VALUES ($1, 'NGN', 0) RETURNING id`,
      [buyer.id],
    );
    const orderId = rows[0]!.id;

    await db.query(
      `INSERT INTO order_items (order_id, course_id, title_snapshot, unit_amount, quantity)
       VALUES ($1, $2, 'Course', 0, 1)`,
      [orderId, course.id],
    );
    await expectSqlError(
      db.query(
        `INSERT INTO order_items (order_id, course_id, title_snapshot, unit_amount, quantity)
         VALUES ($1, $2, 'Course', 0, 1)`,
        [orderId, course.id],
      ),
      '23505',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO order_items (order_id, course_id, title_snapshot, unit_amount, quantity)
         VALUES ($1, $2, 'Course', 0, 0)`,
        [orderId, course.id],
      ),
      '23514',
    );

    await db.query('DELETE FROM orders WHERE id = $1', [orderId]);
    const { rows: items } = await db.query('SELECT id FROM order_items WHERE order_id = $1', [orderId]);
    expect(items).toHaveLength(0);
  });

  it('enforces unique provider payment references per provider', async () => {
    db = await createTestDb();
    const owner = await insertUser(db);
    const buyer = await insertUser(db);
    const course = await insertCourse(db, owner.id);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO orders (user_id, currency, total_amount) VALUES ($1, 'NGN', 0) RETURNING id`,
      [buyer.id],
    );
    const orderId = rows[0]!.id;

    await db.query(
      `INSERT INTO payments (order_id, provider, provider_reference, status, amount, currency)
       VALUES ($1, 'paystack', 'ref-1', 'succeeded', 100, 'NGN')`,
      [orderId],
    );
    await expectSqlError(
      db.query(
        `INSERT INTO payments (order_id, provider, provider_reference, status, amount, currency)
         VALUES ($1, 'paystack', 'ref-1', 'pending', 100, 'NGN')`,
        [orderId],
      ),
      '23505',
    );
    // same reference under a different provider is a different namespace
    await db.query(
      `INSERT INTO payments (order_id, provider, provider_reference, status, amount, currency)
       VALUES ($1, 'otherpay', 'ref-1', 'pending', 100, 'NGN')`,
      [orderId],
    );
    // null references are not constrained by the partial unique index
    await db.query(
      `INSERT INTO payments (order_id, provider, status, amount, currency)
       VALUES ($1, 'paystack', 'initiated', 100, 'NGN')`,
      [orderId],
    );
    await expectSqlError(
      db.query(
        `INSERT INTO payments (order_id, provider, status, amount, currency)
         VALUES ($1, 'paystack', 'teleported', 100, 'NGN')`,
        [orderId],
      ),
      '23514',
    );
  });

  it('enforces unique webhook event identity (idempotency foundation)', async () => {
    db = await createTestDb();
    await db.query(
      `INSERT INTO payment_events (provider, event_id, event_type) VALUES ('paystack', 'evt-1', 'payment.success')`,
    );
    await expectSqlError(
      db.query(
        `INSERT INTO payment_events (provider, event_id, event_type) VALUES ('paystack', 'evt-1', 'payment.success')`,
      ),
      '23505',
    );
    await expectSqlError(
      db.query(
        `INSERT INTO payment_events (provider, event_id, status) VALUES ('paystack', 'evt-2', 'mystery')`,
      ),
      '23514',
    );
  });
});

describe('entitlements', () => {
  it('allows only one entitlement per user/course and requires revocation metadata', async () => {
    db = await createTestDb();
    const owner = await insertUser(db);
    const learner = await insertUser(db);
    const course = await insertCourse(db, owner.id);

    await db.query(
      `INSERT INTO entitlements (user_id, course_id, source) VALUES ($1, $2, 'purchase')`,
      [learner.id, course.id],
    );
    await expectSqlError(
      db.query(
        `INSERT INTO entitlements (user_id, course_id, source) VALUES ($1, $2, 'purchase')`,
        [learner.id, course.id],
      ),
      '23505',
    );
    await expectSqlError(
      db.query(
        `UPDATE entitlements SET status = 'revoked' WHERE user_id = $1 AND course_id = $2`,
        [learner.id, course.id],
      ),
      '23514', // revocation requires reason + timestamp
    );
    // valid revocation
    await db.query(
      `UPDATE entitlements
          SET status = 'revoked', revoked_at = now(), revoked_reason = 'chargeback'
        WHERE user_id = $1 AND course_id = $2`,
      [learner.id, course.id],
    );
  });

  it('restricts deleting users/courses with entitlement history', async () => {
    db = await createTestDb();
    const owner = await insertUser(db);
    const learner = await insertUser(db);
    const course = await insertCourse(db, owner.id);
    await db.query(
      `INSERT INTO entitlements (user_id, course_id, source) VALUES ($1, $2, 'purchase')`,
      [learner.id, course.id],
    );
    await expectSqlError(db.query('DELETE FROM users WHERE id = $1', [learner.id]), '23001');
    await expectSqlError(db.query('DELETE FROM courses WHERE id = $1', [course.id]), '23001');
  });
});

describe('sessions', () => {
  it('requires revocation reason and timestamp together', async () => {
    db = await createTestDb();
    const user = await insertUser(db);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
       VALUES ($1, 'hash-x', now() + interval '1 day') RETURNING id`,
      [user.id],
    );
    const sessionId = rows[0]!.id;

    await expectSqlError(
      db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]),
      '23514',
    );
    await expectSqlError(
      db.query(`UPDATE sessions SET revoked_reason = 'logout' WHERE id = $1`, [sessionId]),
      '23514',
    );
    await db.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1`,
      [sessionId],
    );
  });
});

describe('audit events', () => {
  it('keeps audit history when the actor account is removed (SET NULL)', async () => {
    db = await createTestDb();
    const actor = await insertUser(db);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO audit_events (actor_user_id, action, target_type, target_id)
       VALUES ($1, 'role.added', 'user', 'someone') RETURNING id`,
      [actor.id],
    );
    const eventId = rows[0]!.id;

    // This user has no RESTRICT-backed history of their own, so deletion is allowed.
    await db.query('DELETE FROM users WHERE id = $1', [actor.id]);
    const { rows: remaining } = await db.query<{ actor_user_id: string | null }>(
      'SELECT actor_user_id FROM audit_events WHERE id = $1',
      [eventId],
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.actor_user_id).toBeNull();
  });
});

describe('performance indexes', () => {
  it('creates the expected indexes for hot query paths', async () => {
    db = await createTestDb();
    const { rows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const indexes = new Set(rows.map((r) => r.indexname));
    for (const expected of [
      'users_email_unique',
      'sessions_user_id_idx',
      'sessions_expires_at_idx',
      'sessions_refresh_token_hash_key',
      'courses_status_idx',
      'courses_created_by_idx',
      'modules_course_id_idx',
      'lessons_module_id_idx',
      'enrollments_user_id_idx',
      'enrollments_course_id_idx',
      'orders_user_id_idx',
      'orders_status_idx',
      'order_items_order_id_idx',
      'payments_order_id_idx',
      'payments_provider_reference_uidx',
      'entitlements_user_id_idx',
      'entitlements_course_id_idx',
      'entitlements_active_uidx',
      'lesson_progress_user_id_idx',
      'lesson_progress_lesson_id_idx',
      'audit_events_created_at_idx',
      'audit_events_actor_user_id_idx',
      'audit_events_action_idx',
    ]) {
      expect(indexes, `missing index ${expected}`).toContain(expected);
    }
  });
});

describe('transactions', () => {
  it('rolls back all statements when the callback throws', async () => {
    db = await createTestDb();
    const before = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM users');

    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO users (email, password_hash, name) VALUES ('rollback@example.com', 'h', 'Rollback')`,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM users');
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [
      'rollback@example.com',
    ]);
    expect(rows).toHaveLength(0);
  });

  it('commits when the callback resolves', async () => {
    db = await createTestDb();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users (email, password_hash, name) VALUES ('commit@example.com', 'h', 'Commit')`,
      );
    });
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', ['commit@example.com']);
    expect(rows).toHaveLength(1);
  });

  it('rejects nested transactions explicitly', async () => {
    db = await createTestDb();
    await expect(
      db.transaction(async (tx) => tx.transaction(async () => undefined)),
    ).rejects.toThrow(/Nested database transactions/);
  });
});

describe('updated_at triggers', () => {
  it('bumps updated_at on UPDATE for maintained tables', async () => {
    db = await createTestDb();
    const user = await insertUser(db);
    const course = await insertCourse(db, user.id);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await db.query('UPDATE users SET name = $2 WHERE id = $1', [user.id, 'Renamed']);
    await db.query('UPDATE courses SET title = $2 WHERE id = $1', [course.id, 'Renamed Course']);

    const { rows: userRows } = await db.query<{ created_at: Date; updated_at: Date }>(
      'SELECT created_at, updated_at FROM users WHERE id = $1',
      [user.id],
    );
    const { rows: courseRows } = await db.query<{ created_at: Date; updated_at: Date }>(
      'SELECT created_at, updated_at FROM courses WHERE id = $1',
      [course.id],
    );
    expect(userRows[0]!.updated_at.getTime()).toBeGreaterThan(userRows[0]!.created_at.getTime());
    expect(courseRows[0]!.updated_at.getTime()).toBeGreaterThan(courseRows[0]!.created_at.getTime());
  });
});
