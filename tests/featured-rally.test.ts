import { visit, type DocumentNode } from 'graphql';
import { rallyMutations } from '../src/graphql/resolvers/mutations/rally';
import { rallyQueries } from '../src/graphql/resolvers/queries/rally';
import { typeDefs } from '../src/graphql/schema';

// Staff pick one rally per organisation to feature on the website's home hero (its video
// plays there). Featuring a rally un-features the others, and the public lookup never
// returns a draft.

function fieldsOf(kind: 'ObjectTypeDefinition' | 'InputObjectTypeDefinition' | 'ObjectTypeExtension', typeName: string): string[] {
  const fields: string[] = [];
  for (const doc of typeDefs as DocumentNode[]) {
    visit(doc, {
      [kind](node: any) {
        if (node.name.value === typeName) fields.push(...(node.fields ?? []).map((f: any) => f.name.value));
      },
    });
  }
  return fields;
}

function argsOf(queryName: string): string[] {
  const args: string[] = [];
  for (const doc of typeDefs as DocumentNode[]) {
    visit(doc, {
      FieldDefinition(node) {
        if (node.name.value === queryName) args.push(...(node.arguments ?? []).map(a => a.name.value));
      },
    });
  }
  return args;
}

function buildContext({ existing = null, user = editor }: { existing?: Record<string, unknown> | null; user?: unknown } = {}) {
  const rally = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(existing),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
    update: jest.fn(async ({ data }: any) => ({ id: 'r1', ...data })),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma: any = { rally };
  prisma.$transaction = jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma));
  return { user, tenant: { id: 't1' }, prisma } as any;
}

const editor = { id: 'u1', tenantId: 't1', roles: ['rally_manager'], permissions: ['rally:create', 'rally:update'] };

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

describe('featured rally: API shape', () => {
  it('exposes isFeatured on rallies and accepts it when saving', () => {
    expect(fieldsOf('ObjectTypeDefinition', 'Rally')).toContain('isFeatured');
    expect(fieldsOf('InputObjectTypeDefinition', 'RallyCreateInput')).toContain('isFeatured');
    expect(fieldsOf('InputObjectTypeDefinition', 'RallyUpdateInput')).toContain('isFeatured');
  });

  it('lets the admin filter the rally list by featured, and the website ask for the featured rally', () => {
    expect(argsOf('getRallies')).toContain('isFeatured');
    expect(fieldsOf('ObjectTypeExtension', 'Query')).toContain('getFeaturedRally');
  });
});

describe('featuring a rally', () => {
  it('creating a featured rally un-features the organisation’s other rallies first', async () => {
    const context = buildContext();
    await rallyMutations.createRally(null, { data: { ...rallyInput, isFeatured: true } }, context);

    expect(context.prisma.rally.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isFeatured: true },
      data: { isFeatured: false },
    });
    expect(context.prisma.rally.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      context.prisma.rally.create.mock.invocationCallOrder[0]
    );
    expect(context.prisma.rally.create.mock.calls[0][0].data.isFeatured).toBe(true);
    expect(context.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('featuring an existing rally un-features every other rally of its organisation', async () => {
    const context = buildContext({ existing: { id: 'r1', tenantId: 't1', slug: 'test', startDate: rallyInput.startDate, endDate: rallyInput.endDate } });
    await rallyMutations.updateRally(null, { id: 'r1', data: { isFeatured: true } }, context);

    expect(context.prisma.rally.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isFeatured: true, id: { not: 'r1' } },
      data: { isFeatured: false },
    });
    expect(context.prisma.rally.update.mock.calls[0][0].data.isFeatured).toBe(true);
  });

  it('leaves other rallies alone when a save does not feature this one', async () => {
    const context = buildContext({ existing: { id: 'r1', tenantId: 't1', slug: 'test', startDate: rallyInput.startDate, endDate: rallyInput.endDate } });
    await rallyMutations.updateRally(null, { id: 'r1', data: { isFeatured: false } }, context);
    await rallyMutations.createRally(null, { data: rallyInput }, context);

    expect(context.prisma.rally.updateMany).not.toHaveBeenCalled();
    expect(context.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('getRallies isFeatured filter', () => {
  it('lists only featured rallies when asked', async () => {
    const context = buildContext();
    await rallyQueries.getRallies(null, { isFeatured: true }, context);
    expect(context.prisma.rally.findMany.mock.calls[0][0].where.isFeatured).toBe(true);
  });

  it('does not filter when the argument is left out', async () => {
    const context = buildContext();
    await rallyQueries.getRallies(null, {}, context);
    expect(context.prisma.rally.findMany.mock.calls[0][0].where).not.toHaveProperty('isFeatured');
  });
});

describe('getFeaturedRally', () => {
  it('returns the organisation’s featured rally, never a draft, to anyone', async () => {
    const context = buildContext({ existing: { id: 'r1' }, user: null });
    await expect(rallyQueries.getFeaturedRally(null, {}, context)).resolves.toEqual({ id: 'r1' });
    expect(context.prisma.rally.findFirst.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      deletedAt: null,
      isFeatured: true,
      status: { not: 'DRAFT' },
    });
  });

  it('answers null without a database call when no organisation is known', async () => {
    const context = { ...buildContext({ user: null }), tenant: null };
    await expect(rallyQueries.getFeaturedRally(null, {}, context)).resolves.toBeNull();
    expect(context.prisma.rally.findFirst).not.toHaveBeenCalled();
  });
});
