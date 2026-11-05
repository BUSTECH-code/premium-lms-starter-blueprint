import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PERMISSIONS } from '@lms/db';
import { createTestApp, login, promoteToAdmin, register, setRoles, type TestApp } from './helpers.js';

let testApp: TestApp | undefined;

afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});

async function makeAdmin(app: TestApp, email: string) {
  const { res, jar } = await register(app.app, { email, name: 'Admin User' });
  await promoteToAdmin(app.db, res.body.user.id as string);
  // re-login so the session reflects the new role (roles are read per request,
  // so the existing session would work too — logging in keeps intent explicit)
  return login(app.app, email);
}

describe('authorization is deny-by-default on admin endpoints', () => {
  it('rejects unauthenticated requests with 401', async () => {
    testApp = await createTestApp();
    const users = await request(testApp.app).get('/api/admin/users');
    expect(users.status).toBe(401);
    expect(users.body.error.code).toBe('authentication_required');

    const roles = await request(testApp.app)
      .patch('/api/admin/users/00000000-0000-0000-0000-000000000000/roles')
      .send({ roles: ['admin'] });
    expect(roles.status).toBe(401);
  });

  it('rejects students and instructors with 403 (permission denied)', async () => {
    testApp = await createTestApp();
    const student = await register(testApp.app, { email: 'student@example.com' });
    const instructorReg = await register(testApp.app, { email: 'instructor@example.com' });
    await setRoles(testApp.db, instructorReg.res.body.user.id as string, ['instructor']);

    for (const jar of [student.jar, instructorReg.jar]) {
      const users = await request(testApp.app).get('/api/admin/users').set('Cookie', jar.header());
      expect(users.status).toBe(403);
      expect(users.body.error.code).toBe('permission_denied');

      const audit = await request(testApp.app)
        .get('/api/admin/audit-events')
        .set('Cookie', jar.header());
      expect(audit.status).toBe(403);

      const patch = await request(testApp.app)
        .patch(`/api/admin/users/${student.res.body.user.id}/roles`)
        .set('Cookie', jar.header())
        .send({ roles: ['admin'] });
      expect(patch.status).toBe(403);
    }
  });

  it('allows admins to list users without exposing credentials', async () => {
    testApp = await createTestApp();
    const { jar } = await makeAdmin(testApp, 'admin@example.com');
    await register(testApp.app, { email: 'learner@example.com' });

    const res = await request(testApp.app).get('/api/admin/users').set('Cookie', jar.header());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.length).toBe(2);
    expect(res.body.items.every((u: Record<string, unknown>) => !('password_hash' in u))).toBe(true);
    const adminItem = res.body.items.find((u: { email: string }) => u.email === 'admin@example.com');
    expect(adminItem.roles).toEqual(['admin']);
  });

  it('supports pagination and search on the user list', async () => {
    testApp = await createTestApp();
    const { jar } = await makeAdmin(testApp, 'admin@example.com');
    for (const email of ['one@example.com', 'two@example.com', 'three@example.com']) {
      await register(testApp.app, { email });
    }

    const page = await request(testApp.app)
      .get('/api/admin/users?limit=2&offset=0')
      .set('Cookie', jar.header());
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBe(4);

    const search = await request(testApp.app)
      .get('/api/admin/users?q=three')
      .set('Cookie', jar.header());
    expect(search.body.total).toBe(1);
    expect(search.body.items[0].email).toBe('three@example.com');

    const invalid = await request(testApp.app)
      .get('/api/admin/users?limit=999')
      .set('Cookie', jar.header());
    expect(invalid.status).toBe(400);
  });
});

describe('role management', () => {
  it('lets an admin change another user’s roles and writes audit events', async () => {
    testApp = await createTestApp();
    const admin = await makeAdmin(testApp, 'admin@example.com');
    const target = await register(testApp.app, { email: 'target@example.com' });

    const res = await request(testApp.app)
      .patch(`/api/admin/users/${target.res.body.user.id}/roles`)
      .set('Cookie', admin.jar.header())
      .send({ roles: ['student', 'instructor'] });
    expect(res.status).toBe(200);
    expect(res.body.changes.added.sort()).toEqual(['instructor']);
    expect(res.body.changes.removed).toEqual([]);
    expect(res.body.user.roles.sort()).toEqual(['instructor', 'student']);
    expect(res.body.user.permissions).toEqual([]);

    // audit trail
    const audit = await request(testApp.app)
      .get('/api/admin/audit-events?action=role.added')
      .set('Cookie', admin.jar.header());
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBe(1);
    expect(audit.body.items[0].action).toBe('role.added');
    expect(audit.body.items[0].targetId).toBe(target.res.body.user.id);
    expect(audit.body.items[0].metadata).toEqual({ role: 'instructor' });
    expect(audit.body.items[0].actorUserId).toBe(admin.res.body.user.id);

    // the change is effective immediately for the target user (fresh login)
    const targetLogin = await login(testApp.app, 'target@example.com');
    expect(targetLogin.res.body.user.roles.sort()).toEqual(['instructor', 'student']);
  });

  it('removes roles that are no longer granted and audits the removal', async () => {
    testApp = await createTestApp();
    const admin = await makeAdmin(testApp, 'admin@example.com');
    const target = await register(testApp.app, { email: 'demote@example.com' });
    const targetId = target.res.body.user.id as string;

    await request(testApp.app)
      .patch(`/api/admin/users/${targetId}/roles`)
      .set('Cookie', admin.jar.header())
      .send({ roles: ['student', 'instructor'] });

    const removal = await request(testApp.app)
      .patch(`/api/admin/users/${targetId}/roles`)
      .set('Cookie', admin.jar.header())
      .send({ roles: ['student'] });
    expect(removal.status).toBe(200);
    expect(removal.body.changes.removed).toEqual(['instructor']);

    const audit = await request(testApp.app)
      .get('/api/admin/audit-events?action=role.removed')
      .set('Cookie', admin.jar.header());
    expect(audit.body.total).toBe(1);
    expect(audit.body.items[0].metadata).toEqual({ role: 'instructor' });
  });

  it('validates the roles payload', async () => {
    testApp = await createTestApp();
    const admin = await makeAdmin(testApp, 'admin@example.com');
    const target = await register(testApp.app, { email: 'validate@example.com' });
    const url = `/api/admin/users/${target.res.body.user.id}/roles`;

    const unknownRole = await request(testApp.app)
      .patch(url)
      .set('Cookie', admin.jar.header())
      .send({ roles: ['superuser'] });
    expect(unknownRole.status).toBe(400);

    const empty = await request(testApp.app)
      .patch(url)
      .set('Cookie', admin.jar.header())
      .send({ roles: [] });
    expect(empty.status).toBe(400);

    const duplicates = await request(testApp.app)
      .patch(url)
      .set('Cookie', admin.jar.header())
      .send({ roles: ['student', 'student'] });
    expect(duplicates.status).toBe(400);

    const badUuid = await request(testApp.app)
      .patch('/api/admin/users/not-a-uuid/roles')
      .set('Cookie', admin.jar.header())
      .send({ roles: ['student'] });
    expect(badUuid.status).toBe(400);
  });

  it('returns 404 for a missing user', async () => {
    testApp = await createTestApp();
    const admin = await makeAdmin(testApp, 'admin@example.com');
    const res = await request(testApp.app)
      .patch('/api/admin/users/00000000-0000-0000-0000-000000000000/roles')
      .set('Cookie', admin.jar.header())
      .send({ roles: ['student'] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('user_not_found');
  });

  it('prevents an admin from removing their own admin role', async () => {
    testApp = await createTestApp();
    const admin = await makeAdmin(testApp, 'last-admin@example.com');
    const adminId = admin.res.body.user.id as string;

    const res = await request(testApp.app)
      .patch(`/api/admin/users/${adminId}/roles`)
      .set('Cookie', admin.jar.header())
      .send({ roles: ['student'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('cannot_demote_self');

    // still an admin in the database
    const { rows } = await testApp.db.query<{ role_key: string }>(
      'SELECT role_key FROM user_roles WHERE user_id = $1',
      [adminId],
    );
    expect(rows.map((r) => r.role_key)).toEqual(['admin']);
  });

  it('does not audit anything when validation fails first', async () => {
    testApp = await createTestApp();
    const admin = await makeAdmin(testApp, 'admin@example.com');
    const target = await register(testApp.app, { email: 'atomic@example.com' });
    await request(testApp.app)
      .patch(`/api/admin/users/${target.res.body.user.id}/roles`)
      .set('Cookie', admin.jar.header())
      .send({ roles: ['bogus-role'] });

    const { rows } = await testApp.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_events`,
    );
    expect(rows[0]!.count).toBe('0');
  });
});

describe('audit review endpoint', () => {
  it('requires audit.read and returns paged events', async () => {
    testApp = await createTestApp();
    const admin = await makeAdmin(testApp, 'admin@example.com');
    const student = await register(testApp.app, { email: 'plain@example.com' });

    const denied = await request(testApp.app)
      .get('/api/admin/audit-events')
      .set('Cookie', student.jar.header());
    expect(denied.status).toBe(403);

    const allowed = await request(testApp.app)
      .get('/api/admin/audit-events?limit=10')
      .set('Cookie', admin.jar.header());
    expect(allowed.status).toBe(200);
    expect(Array.isArray(allowed.body.items)).toBe(true);
    expect(allowed.body).toHaveProperty('total');
  });
});

describe('permission constants', () => {
  it('exposes the Phase 1 baseline permissions', () => {
    expect(Object.values(PERMISSIONS).sort()).toEqual([
      'audit.read',
      'users.manage_roles',
      'users.read',
    ]);
  });
});
