jest.mock('../src/libs/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ sent: false, reason: 'test' }),
  getAdminNotifyEmail: jest.fn().mockReturnValue('admin@example.com'),
}));

import { applicationQueries } from '../src/graphql/resolvers/queries/application';
import { applicationMutations } from '../src/graphql/resolvers/mutations/application';
import { canManageApplications } from '../src/utils/application-access';

function context(user: unknown) {
  return {
    user,
    tenant: { id: 'tenant-1' },
    prisma: {
      rallyApplication: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue({ id: 'app-1', status: 'PENDING', rallyId: 'r1', rally: { maxParticipants: null } }),
        update: jest.fn().mockResolvedValue({ id: 'app-1', status: 'REJECTED' }),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
      },
      rally: { update: jest.fn() },
    },
  } as any;
}

const ADMIN = { id: 'u1', roles: ['admin'], permissions: ['rally:read', 'rally:update'] };

describe('canManageApplications', () => {
  it('allows tenant admins, super admins and holders of application:manage', () => {
    expect(canManageApplications({ roles: ['admin'], permissions: [] })).toBe(true);
    expect(canManageApplications({ roles: ['super_admin'], permissions: [] })).toBe(true);
    expect(canManageApplications({ roles: [], permissions: ['application:manage'] })).toBe(true);
  });

  it('does not treat content-editing rights (rally:update) as access to applicant data', () => {
    expect(canManageApplications({ roles: ['editor'], permissions: ['rally:update'] })).toBe(false);
  });

  it('refuses anonymous visitors and users without those rights', () => {
    expect(canManageApplications(undefined)).toBe(false);
    expect(canManageApplications({ roles: ['editor'], permissions: ['rally:read'] })).toBe(false);
  });
});

describe('application data is admin-only (it holds applicants\' personal details)', () => {
  it.each(['getApplications', 'getApplication', 'getPendingApplications', 'getApprovedApplications', 'getApplicationStats'])(
    '%s refuses an anonymous visitor',
    async (name) => {
      const resolver = (applicationQueries as Record<string, (...args: any[]) => Promise<unknown>>)[name];
      await expect(resolver(null, { id: 'app-1' }, context(undefined))).rejects.toThrow(/authentication required/i);
    }
  );

  it('getApplications works for an admin', async () => {
    const result = (await applicationQueries.getApplications(null, {}, context(ADMIN))) as { applications: unknown[] };
    expect(result.applications).toEqual([]);
  });
});

describe('admin actions accept real (string) permissions', () => {
  it('an admin can reject an application (the old object-shaped check always denied)', async () => {
    const ctx = context(ADMIN);
    await applicationMutations.rejectApplication(null, { id: 'app-1', reason: 'Full' }, ctx);
    expect(ctx.prisma.rallyApplication.update).toHaveBeenCalled();
  });

  it('a logged-in user without rights is refused', async () => {
    await expect(
      applicationMutations.rejectApplication(null, { id: 'app-1', reason: 'Full' }, context({ id: 'u2', roles: [], permissions: [] }))
    ).rejects.toThrow(/permission/i);
  });
});

describe('Rally.applications (public rally queries load the latest applications)', () => {
  // Imported lazily so the module graph above stays the same for the other tests.
  const { default: resolvers } = require('../src/graphql/resolvers') as { default: { Rally: Record<string, any> } };
  const parent = { id: 'r1', applications: [{ id: 'app-1', email: 'jane@example.com' }] };

  it('returns nothing to an anonymous visitor', async () => {
    expect(await resolvers.Rally.applications(parent, {}, { user: undefined })).toEqual([]);
  });

  it('returns the loaded applications to an admin', async () => {
    expect(await resolvers.Rally.applications(parent, {}, { user: ADMIN })).toEqual(parent.applications);
  });
});
