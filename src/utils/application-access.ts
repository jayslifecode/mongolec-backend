import { AuthenticationError, AuthorizationError } from '@/utils/errors';

/**
 * Who may read and act on rally applications (they hold applicants' personal details).
 * Permissions in the auth context are "resource:action" strings; there is no seeded
 * application:* permission, so tenant admins (role or rally:update) qualify, plus
 * application:manage should it be seeded later.
 */
const MANAGER_ROLES = ['admin', 'super_admin'];
const MANAGER_PERMISSIONS = ['application:manage', 'rally:update'];

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
