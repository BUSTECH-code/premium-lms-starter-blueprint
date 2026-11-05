/**
 * RBAC reference data — the single TypeScript source of truth that mirrors
 * `src/migrations/0002_rbac_seed.sql`.
 *
 * IMPORTANT (decision discipline):
 * The final permission matrix is an OPEN product decision (see
 * `docs/product/open-requirements.md` — "Final roles and permission matrix" and
 * O-03 "Who can create, review and publish courses?"). The permissions below
 * are the minimal Phase 1 baseline derived from the *potential responsibilities*
 * listed in `docs/product/user-roles.md`:
 *   - Administrator: "Manage users and roles", "Review audit records and reports".
 *   - Student / Instructor: no elevated permissions yet. Instructor content
 *     permissions are intentionally withheld until O-03 is resolved.
 * Do not add permissions here without an approved product decision.
 */

export const ROLES = ['student', 'instructor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_MANAGE_ROLES: 'users.manage_roles',
  AUDIT_READ: 'audit.read',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Baseline role → permission grants (deny by default for every other pair). */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  student: [],
  instructor: [],
  admin: [PERMISSIONS.USERS_READ, PERMISSIONS.USERS_MANAGE_ROLES, PERMISSIONS.AUDIT_READ],
};

/** The role assigned to a newly registered account. */
export const DEFAULT_ROLE: Role = 'student';

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: string): value is Permission {
  return (Object.values(PERMISSIONS) as readonly string[]).includes(value);
}

export function permissionsForRoles(roles: readonly string[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    if (isRole(role)) {
      for (const permission of ROLE_PERMISSIONS[role]) granted.add(permission);
    }
  }
  return [...granted];
}
