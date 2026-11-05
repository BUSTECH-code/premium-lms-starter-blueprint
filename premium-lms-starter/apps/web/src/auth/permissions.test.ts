import { describe, expect, it } from 'vitest';
import { can, hasRole, routeAllows, type SessionUser } from './permissions.js';

const admin: SessionUser = {
  id: 'u-1',
  email: 'admin@example.com',
  name: 'Admin',
  status: 'active',
  roles: ['admin'],
  permissions: ['users.read', 'users.manage_roles', 'audit.read'],
};

const student: SessionUser = {
  id: 'u-2',
  email: 'student@example.com',
  name: 'Student',
  status: 'active',
  roles: ['student'],
  permissions: [],
};

describe('can', () => {
  it('grants only listed permissions', () => {
    expect(can(admin, 'users.read')).toBe(true);
    expect(can(admin, 'users.delete')).toBe(false);
    expect(can(student, 'users.read')).toBe(false);
    expect(can(null, 'users.read')).toBe(false);
  });
});

describe('hasRole', () => {
  it('matches assigned roles only', () => {
    expect(hasRole(admin, 'admin')).toBe(true);
    expect(hasRole(admin, 'student')).toBe(false);
    expect(hasRole(student, 'student')).toBe(true);
    expect(hasRole(undefined, 'student')).toBe(false);
  });
});

describe('routeAllows — deny by default', () => {
  it('rejects anonymous users for any requirement', () => {
    expect(routeAllows(null)).toBe(false);
    expect(routeAllows(undefined, { roles: ['admin'] })).toBe(false);
  });

  it('allows authenticated users when no requirement is set', () => {
    expect(routeAllows(student)).toBe(true);
  });

  it('requires at least one matching role when roles are listed', () => {
    expect(routeAllows(admin, { roles: ['admin'] })).toBe(true);
    expect(routeAllows(student, { roles: ['admin'] })).toBe(false);
    expect(routeAllows(student, { roles: ['admin', 'student'] })).toBe(true);
  });

  it('requires every listed permission', () => {
    expect(routeAllows(admin, { permissions: ['users.read'] })).toBe(true);
    expect(routeAllows(admin, { permissions: ['users.read', 'audit.read'] })).toBe(true);
    expect(routeAllows(admin, { permissions: ['users.read', 'nonexistent.permission'] })).toBe(false);
    expect(routeAllows(student, { permissions: ['users.read'] })).toBe(false);
  });

  it('combines roles and permissions conjunctively', () => {
    expect(routeAllows(admin, { roles: ['admin'], permissions: ['users.read'] })).toBe(true);
    expect(routeAllows(student, { roles: ['admin'], permissions: ['users.read'] })).toBe(false);
    expect(routeAllows(admin, { roles: ['student'], permissions: ['users.read'] })).toBe(false);
  });
});
