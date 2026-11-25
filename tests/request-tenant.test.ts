import { resolveRequestTenant, type RequestTenant } from '../src/utils/request-tenant';

const MEC: RequestTenant = { id: 'tenant-mec', slug: 'mec', name: 'MEC', status: 'ACTIVE' };
const RFR: RequestTenant = {
  id: 'tenant-rfr',
  slug: 'rally-for-rangers',
  name: 'Rally for Rangers',
  status: 'ACTIVE',
};

function lookupOf(...tenants: RequestTenant[]) {
  return jest.fn(
    async (slugOrId: string) => tenants.find(t => t.slug === slugOrId || t.id === slugOrId) ?? null
  );
}

const superAdmin = { roles: ['super_admin'] };
const admin = { roles: ['admin'] };

describe('resolveRequestTenant', () => {
  it('uses the X-Tenant-ID header for an anonymous request (public website)', async () => {
    const tenant = await resolveRequestTenant({
      authTenant: null,
      user: null,
      headerValue: 'rally-for-rangers',
      lookup: lookupOf(RFR),
    });
    expect(tenant).toEqual(RFR);
  });

  it('returns null for an anonymous request without a header', async () => {
    const lookup = lookupOf(RFR);
    const tenant = await resolveRequestTenant({
      authTenant: null,
      user: null,
      headerValue: undefined,
      lookup,
    });
    expect(tenant).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('lets a super_admin work in another tenant named by the header', async () => {
    const tenant = await resolveRequestTenant({
      authTenant: MEC,
      user: superAdmin,
      headerValue: 'rally-for-rangers',
      lookup: lookupOf(MEC, RFR),
    });
    expect(tenant).toEqual(RFR);
  });

  it('ignores the header for anyone who is not a super_admin', async () => {
    const lookup = lookupOf(MEC, RFR);
    const tenant = await resolveRequestTenant({
      authTenant: MEC,
      user: admin,
      headerValue: 'rally-for-rangers',
      lookup,
    });
    expect(tenant).toEqual(MEC);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps the super_admin's own tenant when the header names no active tenant", async () => {
    const tenant = await resolveRequestTenant({
      authTenant: MEC,
      user: superAdmin,
      headerValue: 'no-such-tenant',
      lookup: lookupOf(MEC, RFR),
    });
    expect(tenant).toEqual(MEC);
  });

  it("keeps the user's own tenant when no header is sent", async () => {
    const lookup = lookupOf(MEC, RFR);
    const tenant = await resolveRequestTenant({
      authTenant: MEC,
      user: superAdmin,
      headerValue: undefined,
      lookup,
    });
    expect(tenant).toEqual(MEC);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips the lookup when the header already names the user tenant (by slug or id)', async () => {
    const lookup = lookupOf(MEC, RFR);
    expect(
      await resolveRequestTenant({ authTenant: MEC, user: superAdmin, headerValue: 'mec', lookup })
    ).toEqual(MEC);
    expect(
      await resolveRequestTenant({
        authTenant: MEC,
        user: superAdmin,
        headerValue: 'tenant-mec',
        lookup,
      })
    ).toEqual(MEC);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('uses the first value when the header is sent more than once', async () => {
    const tenant = await resolveRequestTenant({
      authTenant: MEC,
      user: superAdmin,
      headerValue: ['rally-for-rangers', 'mec'],
      lookup: lookupOf(MEC, RFR),
    });
    expect(tenant).toEqual(RFR);
  });
});
