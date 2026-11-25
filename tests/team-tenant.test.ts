import { teamMutations } from '../src/graphql/resolvers/mutations/team';

// A super_admin from the `mec` tenant working on Rally for Rangers: the request tenant
// (context.tenant) is RFR, while the user's own tenant stays mec.
function buildContext() {
  const prisma = {
    teamMember: {
      count: jest.fn().mockResolvedValue(3),
      findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'tm-1' }, { id: 'tm-2' }]),
      create: jest.fn().mockResolvedValue({ id: 'tm-new' }),
      update: jest.fn().mockResolvedValue({ id: 'tm-1' }),
      delete: jest.fn().mockResolvedValue({ id: 'tm-1' }),
    },
  };
  return {
    tenant: { id: 'tenant-rfr' },
    user: {
      id: 'admin-1',
      tenantId: 'tenant-mec',
      roles: ['super_admin'],
      permissions: ['content:create', 'content:update', 'content:delete'],
    },
    prisma,
  } as any;
}

describe('team mutations use the request tenant, not the user home tenant', () => {
  it('createTeamMember files the member under the request tenant', async () => {
    const context = buildContext();
    await teamMutations.createTeamMember(
      null,
      { data: { name: 'Anna', role: 'Guide' } } as any,
      context
    );
    expect(context.prisma.teamMember.create.mock.calls[0][0].data.tenantId).toBe('tenant-rfr');
  });

  it('createTeamMember still honours an explicit tenantId from a super_admin', async () => {
    const context = buildContext();
    await teamMutations.createTeamMember(
      null,
      { data: { name: 'Anna', role: 'Guide', tenantId: 'tenant-other' } } as any,
      context
    );
    expect(context.prisma.teamMember.create.mock.calls[0][0].data.tenantId).toBe('tenant-other');
  });

  it('updateTeamMember finds the member in the request tenant', async () => {
    const context = buildContext();
    await teamMutations.updateTeamMember(null, { id: 'tm-1', data: { name: 'Anna K' } }, context);
    expect(context.prisma.teamMember.findFirst).toHaveBeenCalledWith({
      where: { id: 'tm-1', tenantId: 'tenant-rfr' },
    });
  });

  it('deleteTeamMember finds the member in the request tenant', async () => {
    const context = buildContext();
    await teamMutations.deleteTeamMember(null, { id: 'tm-1' }, context);
    expect(context.prisma.teamMember.findFirst).toHaveBeenCalledWith({
      where: { id: 'tm-1', tenantId: 'tenant-rfr' },
    });
  });

  it('reorderTeamMembers works on the request tenant', async () => {
    const context = buildContext();
    await teamMutations.reorderTeamMembers(null, { ids: ['tm-1', 'tm-2'] }, context);
    expect(context.prisma.teamMember.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-rfr');
  });
});
