import { rallyMutations } from '../src/graphql/resolvers/mutations/rally';
import { teamQueries } from '../src/graphql/resolvers/queries/team';
import { visit, type DocumentNode } from 'graphql';
import { typeDefs } from '../src/graphql/schema';

function rallyContext(existing: Record<string, unknown> | null = null) {
  return {
    user: {
      id: 'u1',
      tenantId: 't1',
      roles: ['admin'],
      permissions: ['rally:create', 'rally:update'],
    },
    tenant: { id: 't1' },
    prisma: {
      rally: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(async ({ data }: any) => ({ id: 'r1', ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'r1', ...data })),
      },
    },
  } as any;
}

const rallyInput = {
  title: { en: 'Test' },
  slug: 'test',
  description: { en: '' },
  location: { en: '' },
  duration: 5,
  targetAudience: { en: '' },
  impactOverview: { en: '' },
  conservationActivities: { en: '' },
  rangerPartnerships: { en: '' },
  startDate: '2030-08-01T00:00:00.000Z',
  endDate: '2030-08-10T00:00:00.000Z',
};

function inputFields(typeName: string): string[] {
  const fields: string[] = [];
  for (const doc of typeDefs as DocumentNode[]) {
    visit(doc, {
      InputObjectTypeDefinition(node) {
        if (node.name.value === typeName)
          fields.push(...(node.fields ?? []).map(f => f.name.value));
      },
    });
  }
  return fields;
}

describe('createRally', () => {
  it('the API accepts a status when creating a rally (the create form has one)', () => {
    expect(inputFields('RallyCreateInput')).toContain('status');
  });

  it('keeps the status chosen on the create form', async () => {
    const context = rallyContext();
    await rallyMutations.createRally(
      null,
      { data: { ...rallyInput, status: 'UPCOMING' } },
      context
    );
    expect(context.prisma.rally.create.mock.calls[0][0].data.status).toBe('UPCOMING');
  });

  it('refuses an end date before the start date', async () => {
    const context = rallyContext();
    await expect(
      rallyMutations.createRally(
        null,
        {
          data: {
            ...rallyInput,
            startDate: '2030-08-10T00:00:00.000Z',
            endDate: '2030-08-01T00:00:00.000Z',
          },
        },
        context
      )
    ).rejects.toThrow(/end date/i);
    expect(context.prisma.rally.create).not.toHaveBeenCalled();
  });
});

describe('updateRally', () => {
  it('refuses moving the end date before the existing start date', async () => {
    const context = rallyContext({
      id: 'r1',
      slug: 'test',
      startDate: new Date('2030-08-01T00:00:00.000Z'),
      endDate: new Date('2030-08-10T00:00:00.000Z'),
    });
    await expect(
      rallyMutations.updateRally(
        null,
        { id: 'r1', data: { endDate: '2030-07-01T00:00:00.000Z' } },
        context
      )
    ).rejects.toThrow(/end date/i);
    expect(context.prisma.rally.update).not.toHaveBeenCalled();
  });
});

describe('getTeamMembers', () => {
  function teamContext(user: unknown) {
    return {
      user,
      tenant: { id: 't1' },
      prisma: { teamMember: { findMany: jest.fn().mockResolvedValue([]) } },
    } as any;
  }

  it('shows the public site only active members', async () => {
    const context = teamContext(null);
    await teamQueries.getTeamMembers(null, {}, context);
    expect(context.prisma.teamMember.findMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  it('shows admins inactive members too, so they can be edited and re-activated', async () => {
    const context = teamContext({ id: 'u1', roles: ['admin'], permissions: ['content:read'] });
    await teamQueries.getTeamMembers(null, {}, context);
    expect(context.prisma.teamMember.findMany.mock.calls[0][0].where).not.toHaveProperty(
      'isActive'
    );
  });
});
