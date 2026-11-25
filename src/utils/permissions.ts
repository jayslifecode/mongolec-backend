import { AuthenticationError, AuthorizationError } from '@/utils/errors';

/**
 * Permission checks. The auth context holds permissions as "resource:action" strings and role
 * names as strings. Several resolvers used to compare `{ resource, action }` objects, which never
 * matched, so stories, nominations, newsletter, media and park partners refused everyone.
 *
 * - super_admin may do anything.
 * - Stories and park partners are content: no story:* or partnership:* permissions are seeded,
 *   so they fall back to the matching content:* permission.
 * - Nominations and the newsletter hold people's personal details, so besides their own
 *   permission only tenant admins (and super admins) may manage them.
 */
const SUPER_ADMIN_ROLE = 'super_admin';
const ADMIN_ROLES = ['admin', SUPER_ADMIN_ROLE];

const CONTENT_FALLBACK: Record<string, string> = {
  'story:create': 'content:create',
  'story:update': 'content:update',
  'story:publish': 'content:publish',
  'story:manage': 'content:update',
  'story:delete': 'content:delete',
  'partnership:create': 'content:create',
  'partnership:update': 'content:update',
  'partnership:manage': 'content:update',
  'partnership:delete': 'content:delete',
};

const ADMIN_ROLE_PERMISSIONS = new Set(['nomination:manage', 'newsletter:manage']);

interface PermissionUser {
  roles?: string[] | null;
  permissions?: string[] | null;
}

export function hasPermission(
  user: PermissionUser | null | undefined,
  permission: string
): boolean {
  if (!user) return false;
  const roles = user.roles ?? [];
  const permissions = user.permissions ?? [];
  if (roles.includes(SUPER_ADMIN_ROLE)) return true;
  if (permissions.includes(permission)) return true;

  const fallback = CONTENT_FALLBACK[permission];
  if (fallback && permissions.includes(fallback)) return true;

  return ADMIN_ROLE_PERMISSIONS.has(permission) && roles.some(role => ADMIN_ROLES.includes(role));
}

/** Throws unless the caller is signed in and holds `permission`. */
export function assertPermission(
  context: { user?: PermissionUser | null },
  permission: string
): void {
  if (!context.user) throw new AuthenticationError('Authentication required');
  if (!hasPermission(context.user, permission)) throw new AuthorizationError(permission);
}
