import type { DbClient } from '../client.js';
import { DEFAULT_ROLE, permissionsForRoles, type Permission, type Role } from '../rbac.js';
import type { UserRow } from '../types.js';

export interface UserWithAccess {
  user: UserRow;
  roles: Role[];
  permissions: Permission[];
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
  /** Defaults to `[DEFAULT_ROLE]` (student). */
  roleKeys?: readonly Role[];
  grantedBy?: string | null;
}

export interface ListUsersOptions {
  limit: number;
  offset: number;
  search?: string;
}

/** User projection safe for listings — deliberately excludes credential columns. */
export type ListedUserRow = Omit<UserRow, 'password_hash' | 'password_algorithm'>;

export interface UserListItem extends ListedUserRow {
  roles: string[];
}

const USER_COLUMNS = `id, email, password_hash, password_algorithm, name, status,
  email_verified_at, created_at, updated_at`;

export async function createUser(db: DbClient, input: CreateUserInput): Promise<UserRow> {
  const roleKeys = input.roleKeys ?? [DEFAULT_ROLE];
  if (roleKeys.length === 0) {
    throw new Error('A user must be granted at least one role');
  }
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<UserRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING ${USER_COLUMNS}`,
      [input.email.trim().toLowerCase(), input.passwordHash, input.name],
    );
    const user = rows[0];
    if (!user) throw new Error('User insert returned no row');

    for (const roleKey of roleKeys) {
      await tx.query(
        `INSERT INTO user_roles (user_id, role_key, granted_by) VALUES ($1, $2, $3)`,
        [user.id, roleKey, input.grantedBy ?? null],
      );
    }
    return user;
  });
}

export async function findUserByEmail(db: DbClient, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function findUserById(db: DbClient, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Load a user together with the roles and permissions effective for them. */
export async function getUserAccess(
  db: DbClient,
  userId: string,
): Promise<UserWithAccess | null> {
  const user = await findUserById(db, userId);
  if (!user) return null;

  const { rows: roleRows } = await db.query<{ role_key: string }>(
    'SELECT role_key FROM user_roles WHERE user_id = $1 ORDER BY role_key',
    [userId],
  );
  const roles = roleRows.map((row) => row.role_key) as Role[];

  const { rows: permissionRows } = await db.query<{ permission_key: string }>(
    `SELECT rp.permission_key
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_key = ur.role_key
      WHERE ur.user_id = $1
      ORDER BY rp.permission_key`,
    [userId],
  );
  const permissions = permissionRows.map((row) => row.permission_key) as Permission[];

  // Defence in depth: fall back to the in-code baseline if seed data drifted.
  if (permissionRows.length === 0 && roles.length > 0) {
    return { user, roles, permissions: permissionsForRoles(roles) };
  }
  return { user, roles, permissions };
}

export async function listUsers(
  db: DbClient,
  options: ListUsersOptions,
): Promise<{ items: UserListItem[]; total: number }> {
  const limit = Math.min(Math.max(options.limit, 1), 100);
  const offset = Math.max(options.offset, 0);
  const search = options.search?.trim();

  const filter = search ? 'WHERE u.email ILIKE $1 OR u.name ILIKE $1' : '';
  const filterParams = search ? [`%${search}%`] : [];

  const { rows: totalRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users u ${filter}`,
    filterParams,
  );
  // Password material is never selected here — listings are not a credential source.
  const { rows } = await db.query<ListedUserRow & { roles: string | null }>(
    `SELECT u.id, u.email, u.name, u.status, u.email_verified_at, u.created_at, u.updated_at,
            (SELECT string_agg(ur.role_key, ',' ORDER BY ur.role_key)
               FROM user_roles ur WHERE ur.user_id = u.id) AS roles
       FROM users u
       ${filter}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
    [...filterParams, limit, offset],
  );

  return {
    items: rows.map(({ roles, ...user }) => ({
      ...user,
      roles: roles ? roles.split(',') : [],
    })),
    total: Number(totalRows[0]?.count ?? 0),
  };
}

export interface SetUserRolesResult {
  added: string[];
  removed: string[];
}

/**
 * Replace a user's role set and return which roles changed.
 *
 * Runs multiple statements WITHOUT opening its own transaction — wrap it in
 * `db.transaction(...)` (as the admin API does) so the change and its audit
 * entries commit atomically.
 */
export async function setUserRoles(
  db: DbClient,
  input: { userId: string; roleKeys: readonly string[]; grantedBy: string },
): Promise<SetUserRolesResult> {
  const { rows: currentRows } = await db.query<{ role_key: string }>(
    'SELECT role_key FROM user_roles WHERE user_id = $1',
    [input.userId],
  );
  const current = new Set(currentRows.map((row) => row.role_key));
  const next = new Set(input.roleKeys);

  const added = [...next].filter((role) => !current.has(role));
  const removed = [...current].filter((role) => !next.has(role));

  for (const role of removed) {
    await db.query(
      'DELETE FROM user_roles WHERE user_id = $1 AND role_key = $2',
      [input.userId, role],
    );
  }
  for (const role of added) {
    await db.query(
      `INSERT INTO user_roles (user_id, role_key, granted_by) VALUES ($1, $2, $3)`,
      [input.userId, role, input.grantedBy],
    );
  }
  return { added, removed };
}
