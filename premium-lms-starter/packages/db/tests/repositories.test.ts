import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  audit,
  createUser,
  findUserByEmail,
  findUserById,
  getUserAccess,
  insertAuditEvent,
  isPermission,
  isRole,
  listAuditEvents,
  listUsers,
  permissionsForRoles,
  sessions,
  setUserRoles,
  type DbClient,
} from '../src/index.js';
import { createTestDb, expectSqlError, insertCourse, insertUser } from './helpers.js';

let db: DbClient;

afterEach(async () => {
  await db?.close().catch(() => undefined);
});

describe('RBAC seed data', () => {
  it('contains exactly the roles and permissions declared in rbac.ts', async () => {
    db = await createTestDb();

    const { rows: roleRows } = await db.query<{ key: string }>('SELECT key FROM roles ORDER BY key');
    expect(roleRows.map((r) => r.key)).toEqual([...ROLES].sort());

    const { rows: permissionRows } = await db.query<{ key: string }>(
      'SELECT key FROM permissions ORDER BY key',
    );
    const dbPermissions = permissionRows.map((r) => r.key);
    const tsPermissions = Object.values(PERMISSIONS).sort();
    expect(dbPermissions).toEqual(tsPermissions);

    // Every permission of every role is present in role_permissions, and the
    // admin baseline matches ROLE_PERMISSIONS exactly.
    for (const role of ROLES) {
      const { rows } = await db.query<{ permission_key: string }>(
        'SELECT permission_key FROM role_permissions WHERE role_key = $1 ORDER BY permission_key',
        [role],
      );
      expect(rows.map((r) => r.permission_key)).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('denies by default — students and instructors hold no elevated permissions', async () => {
    db = await createTestDb();
    expect(permissionsForRoles(['student'])).toEqual([]);
    expect(permissionsForRoles(['instructor'])).toEqual([]);
    expect(permissionsForRoles(['admin']).sort()).toEqual(Object.values(PERMISSIONS).sort());
    expect(permissionsForRoles(['nonsense-role'])).toEqual([]);
  });

  it('type guards accept only known roles/permissions', () => {
    expect(isRole('student')).toBe(true);
    expect(isRole('root')).toBe(false);
    expect(isPermission(PERMISSIONS.USERS_READ)).toBe(true);
    expect(isPermission('users.delete')).toBe(false);
  });
});

describe('users repository', () => {
  it('creates a user with the default student role and normalises the email', async () => {
    db = await createTestDb();
    const user = await createUser(db, {
      email: '  Ada@Example.COM ',
      passwordHash: '$argon2id$fake',
      name: 'Ada Lovelace',
    });
    expect(user.email).toBe('ada@example.com');
    expect(user.status).toBe('active');

    const access = await getUserAccess(db, user.id);
    expect(access?.roles).toEqual([DEFAULT_ROLE]);
    expect(access?.permissions).toEqual([]);
  });

  it('finds users by email case-insensitively via normalisation', async () => {
    db = await createTestDb();
    await createUser(db, { email: 'findme@example.com', passwordHash: 'h', name: 'Find Me' });
    const found = await findUserByEmail(db, 'FINDME@EXAMPLE.COM');
    expect(found?.email).toBe('findme@example.com');
    expect(await findUserByEmail(db, 'missing@example.com')).toBeNull();
    expect(await findUserById(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('refuses to create a user without any role', async () => {
    db = await createTestDb();
    await expect(
      createUser(db, { email: 'no-role@example.com', passwordHash: 'h', name: 'X', roleKeys: [] }),
    ).rejects.toThrow(/at least one role/);
  });

  it('lists users with roles, totals and search filtering', async () => {
    db = await createTestDb();
    const admin = await createUser(db, {
      email: 'admin@example.com',
      passwordHash: 'h',
      name: 'Admin',
      roleKeys: ['admin'],
    });
    await createUser(db, { email: 'student@example.com', passwordHash: 'h', name: 'Student' });

    const all = await listUsers(db, { limit: 10, offset: 0 });
    expect(all.total).toBe(2);
    const adminItem = all.items.find((u) => u.id === admin.id);
    expect(adminItem?.roles).toEqual(['admin']);
    // listings must never carry credential material
    expect(all.items.every((u) => !('password_hash' in u))).toBe(true);

    const filtered = await listUsers(db, { limit: 10, offset: 0, search: 'admin@' });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]?.email).toBe('admin@example.com');
  });

  it('replaces roles and reports the diff', async () => {
    db = await createTestDb();
    const actor = await createUser(db, {
      email: 'root@example.com',
      passwordHash: 'h',
      name: 'Root',
      roleKeys: ['admin'],
    });
    const target = await createUser(db, { email: 'target@example.com', passwordHash: 'h', name: 'T' });

    // target starts as a student, so the first replacement drops it
    const result = await db.transaction((tx) =>
      setUserRoles(tx, { userId: target.id, roleKeys: ['instructor', 'admin'], grantedBy: actor.id }),
    );
    expect(result.added.sort()).toEqual(['admin', 'instructor']);
    expect(result.removed).toEqual(['student']);

    const access = await getUserAccess(db, target.id);
    expect(access?.roles?.sort()).toEqual(['admin', 'instructor']);
    expect(access?.permissions.sort()).toEqual(Object.values(PERMISSIONS).sort());

    const second = await db.transaction((tx) =>
      setUserRoles(tx, { userId: target.id, roleKeys: ['student'], grantedBy: actor.id }),
    );
    expect(second.removed.sort()).toEqual(['admin', 'instructor']);
    expect(second.added).toEqual(['student']);
  });
});

describe('sessions repository', () => {
  it('creates, rotates and revokes sessions', async () => {
    db = await createTestDb();
    const user = await insertUser(db);
    const session = await sessions.createSession(db, {
      userId: user.id,
      refreshTokenHash: 'hash-1',
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });

    const found = await sessions.findSessionByRefreshHash(db, 'hash-1');
    expect(found?.id).toBe(session.id);
    expect(await sessions.findSessionById(db, session.id)).not.toBeNull();

    const rotated = await sessions.rotateSession(db, {
      sessionId: session.id,
      currentHash: 'hash-1',
      newHash: 'hash-2',
    });
    expect(rotated?.previous_refresh_token_hash).toBe('hash-1');
    expect(rotated?.refresh_token_hash).toBe('hash-2');
    expect(await sessions.findSessionByPreviousRefreshHash(db, 'hash-1')).not.toBeNull();

    // rotating again with the stale hash must fail (optimistic concurrency)
    const stale = await sessions.rotateSession(db, {
      sessionId: session.id,
      currentHash: 'hash-1',
      newHash: 'hash-3',
    });
    expect(stale).toBeNull();

    const revoked = await sessions.revokeSession(db, { sessionId: session.id, reason: 'logout' });
    expect(revoked).toBe(true);
    // second revoke is a no-op
    expect(await sessions.revokeSession(db, { sessionId: session.id, reason: 'logout' })).toBe(false);
    const after = await sessions.findSessionById(db, session.id);
    expect(after?.revoked_at).not.toBeNull();
    expect(after?.revoked_reason).toBe('logout');

    // revoked sessions cannot rotate
    const blocked = await sessions.rotateSession(db, {
      sessionId: session.id,
      currentHash: 'hash-2',
      newHash: 'hash-4',
    });
    expect(blocked).toBeNull();
  });

  it('cascades session deletion when the user is deleted', async () => {
    db = await createTestDb();
    const user = await insertUser(db);
    await sessions.createSession(db, {
      userId: user.id,
      refreshTokenHash: 'cascade-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    expect(await sessions.findSessionByRefreshHash(db, 'cascade-hash')).toBeNull();
  });
});

describe('audit repository', () => {
  it('inserts and lists audit events with filtering', async () => {
    db = await createTestDb();
    const actor = await insertUser(db);
    const target = await insertUser(db);

    await insertAuditEvent(db, {
      actorUserId: actor.id,
      action: 'role.added',
      targetType: 'user',
      targetId: target.id,
      metadata: { role: 'admin' },
      ipAddress: '127.0.0.1',
    });
    await insertAuditEvent(db, {
      actorUserId: actor.id,
      action: 'role.removed',
      targetType: 'user',
      targetId: target.id,
      metadata: { role: 'instructor' },
    });

    const all = await listAuditEvents(db, { limit: 10, offset: 0 });
    expect(all.total).toBe(2);

    const filtered = await listAuditEvents(db, { limit: 10, offset: 0, action: 'role.added' });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]?.metadata).toEqual({ role: 'admin' });
    expect(filtered.items[0]?.actor_user_id).toBe(actor.id);

    await expectSqlError(
      db.query(`INSERT INTO audit_events (actor_user_id, action) VALUES ($1, '')`, [actor.id]),
      '23514',
    );
  });

  it('exposes listAuditEvents via both namespace and flat export', () => {
    expect(audit.listAuditEvents).toBe(listAuditEvents);
  });
});
