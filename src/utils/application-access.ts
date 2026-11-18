import { AuthenticationError, AuthorizationError } from '@/utils/errors';

/**
 * Who may read and act on rally applications (they hold applicants' personal details and
 * passport copies). Permissions in the auth context are "resource:action" strings. Tenant admins
 * and super admins qualify, plus application:manage should it be seeded later. Content-editing
 * rights such as rally:update deliberately do not.
 */
const MANAGER_ROLES = ['admin', 'super_admin'];
const MANAGER_PERMISSIONS = ['application:manage'];

interface AccessUser {
  roles?: string[] | null;
  permissions?: string[] | null;
}

export function canManageApplications(user: AccessUser | null | undefined): boolean {
  if (!user) return false;
  const roles = user.roles ?? [];
  const permissions = user.permissions ?? [];
  return roles.some((role) => MANAGER_ROLES.includes(role)) || permissions.some((p) => MANAGER_PERMISSIONS.includes(p));
}

/** Throws unless the caller is logged in and may manage applications. */
export function assertCanManageApplications(context: { user?: AccessUser | null }): void {
  if (!context.user) throw new AuthenticationError('Authentication required');
  if (!canManageApplications(context.user)) throw new AuthorizationError('application:manage');
}
