/**
 * Pure authorisation helpers shared by route guards.
 * The server is always the authority — these functions only decide what the
 * UI shows; every API request is authorised again on the server.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: string[];
  permissions: string[];
}

export function can(user: SessionUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function hasRole(user: SessionUser | null | undefined, role: string): boolean {
  if (!user) return false;
  return user.roles.includes(role);
}

export interface RouteRequirement {
  roles?: string[];
  permissions?: string[];
}

/** Deny by default: anonymous users never pass; listed roles/permissions must match. */
export function routeAllows(
  user: SessionUser | null | undefined,
  requirement: RouteRequirement = {},
): boolean {
  if (!user) return false;
  if (requirement.permissions && requirement.permissions.length > 0) {
    if (!requirement.permissions.every((permission) => can(user, permission))) return false;
  }
  if (requirement.roles && requirement.roles.length > 0) {
    if (!requirement.roles.some((role) => hasRole(user, role))) return false;
  }
  return true;
}
