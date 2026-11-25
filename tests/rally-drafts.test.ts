import { rallyQueries } from '../src/graphql/resolvers/queries/rally';

// A DRAFT rally is work in progress in the admin; the public website must not show it,
// even to someone who guesses its address.
function buildContext(user: unknown) {
  return {
    user,
    tenant: { id: 't1' },
    prisma: {
      rally: {
        findFirst: jest.fn().mockResolvedValue({ id: 'r1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    },
  } as any;
}

const admin = { id: 'u1', roles: ['admin'], permissions: ['rally:read'] };

describe('draft rallies stay out of public view', () => {
  it('getRally hides drafts from anonymous visitors', async () => {
    const context = buildContext(null);
    await rallyQueries.getRally(null, { slug: 'x' }, context);
    expect(context.prisma.rally.findFirst.mock.calls[0][0].where.status).toEqual({ not: 'DRAFT' });
  });

  it('getRally still finds drafts for signed-in admins (the edit page)', async () => {
    const context = buildContext(admin);
    await rallyQueries.getRally(null, { id: 'r1' }, context);
    expect(context.prisma.rally.findFirst.mock.calls[0][0].where).not.toHaveProperty('status');
  });

  it('getRallies leaves drafts out of public lists', async () => {
    const context = buildContext(null);
    await rallyQueries.getRallies(null, {}, context);
    expect(context.prisma.rally.findMany.mock.calls[0][0].where.status).toEqual({ not: 'DRAFT' });
  });

  it('getRallies lists drafts for admins', async () => {
    const context = buildContext(admin);
    await rallyQueries.getRallies(null, {}, context);
    expect(context.prisma.rally.findMany.mock.calls[0][0].where).not.toHaveProperty('status');
  });
});
