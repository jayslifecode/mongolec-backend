/**
 * Which tenant a GraphQL request works in.
 *
 * - Anonymous requests (the public websites) name their tenant in the X-Tenant-ID header.
 * - Signed-in users work in their own tenant.
 * - A super_admin may work in another tenant by naming it in X-Tenant-ID. The admin app does
 *   this on its Rally for Rangers pages: the admins belong to `mec`, while all Rally for
 *   Rangers data lives in `rally-for-rangers`. Without it, their lookups come back empty and
 *   new records are filed under `mec`.
 * - Anyone else's header is ignored, so it can never widen what a non-super_admin sees.
 */
export interface RequestTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan?: string;
}

/** Finds an ACTIVE, non-deleted tenant by slug or id. */
export type TenantLookup = (slugOrId: string) => Promise<RequestTenant | null>;

interface ResolveRequestTenantParams {
  authTenant: RequestTenant | null;
  user: { roles?: string[] } | null;
  headerValue: string | string[] | undefined;
  lookup: TenantLookup;
}

const SUPER_ADMIN_ROLE = 'super_admin';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveRequestTenant({
  authTenant,
  user,
  headerValue,
  lookup,
}: ResolveRequestTenantParams): Promise<RequestTenant | null> {
  const requested = firstHeaderValue(headerValue);

  if (!authTenant) {
    return requested ? lookup(requested) : null;
  }

  const isSuperAdmin = user?.roles?.includes(SUPER_ADMIN_ROLE) ?? false;
  if (!isSuperAdmin || !requested) return authTenant;
  if (requested === authTenant.slug || requested === authTenant.id) return authTenant;

  return (await lookup(requested)) ?? authTenant;
}
