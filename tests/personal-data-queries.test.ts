import { newsletterQueries } from '../src/graphql/resolvers/queries/newsletter';
import { nominationQueries } from '../src/graphql/resolvers/queries/nomination';
import { AuthenticationError, AuthorizationError } from '../src/utils/errors';

// Newsletter subscribers and park nominations hold people's names and emails. Only signed-in
// staff allowed to manage them may read them; the public website never lists them.
function buildContext(user: unknown) {
  const model = () => ({
    findFirst: jest.fn().mockResolvedValue({ id: 'x1' }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  });
  return {
    user,
    tenant: { id: 't1' },
    prisma: { newsletterSubscription: model(), parkNomination: model() },
  } as any;
}

const editor = { id: 'u1', roles: ['editor'], permissions: ['content:read', 'content:update'] };
const tenantAdmin = { id: 'u2', roles: ['admin'], permissions: [] };
const rallyManager = { id: 'u3', roles: ['rally_manager'], permissions: ['newsletter:manage', 'nomination:manage'] };

type Resolver = (parent: unknown, args: any, context: any) => Promise<unknown>;

const PROTECTED: Array<[string, Resolver, Record<string, unknown>]> = [
  ['getNewsletterSubscriptions', newsletterQueries.getNewsletterSubscriptions, {}],
  ['getNewsletterSubscription', newsletterQueries.getNewsletterSubscription, { id: 'x1' }],
  ['getNewsletterStats', newsletterQueries.getNewsletterStats, {}],
  ['getNominations', nominationQueries.getNominations, {}],
  ['getNomination', nominationQueries.getNomination, { id: 'x1' }],
  ['getPendingNominations', nominationQueries.getPendingNominations, {}],
  ['getApprovedNominations', nominationQueries.getApprovedNominations, {}],
  ['getNominationStats', nominationQueries.getNominationStats, {}],
];

describe.each(PROTECTED)('%s', (_name, resolve, args) => {
  it('refuses logged-out visitors without touching the database', async () => {
    const context = buildContext(null);
    await expect(resolve(null, args, context)).rejects.toBeInstanceOf(AuthenticationError);
    expect(context.prisma.newsletterSubscription.findMany).not.toHaveBeenCalled();
    expect(context.prisma.parkNomination.findMany).not.toHaveBeenCalled();
  });

  it('refuses signed-in users who only edit content', async () => {
    await expect(resolve(null, args, buildContext(editor))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('answers tenant admins', async () => {
    await expect(resolve(null, args, buildContext(tenantAdmin))).resolves.toBeDefined();
  });

  it('answers users granted the manage permission', async () => {
    await expect(resolve(null, args, buildContext(rallyManager))).resolves.toBeDefined();
  });
});

describe('checkHasNominated', () => {
  it('stays public: the nomination form asks it before submitting, and it reveals only yes/no', async () => {
    const context = buildContext(null);
    await expect(
      nominationQueries.checkHasNominated(null, { rallyId: 'r1', email: 'a@b.c' }, context)
    ).resolves.toBe(true);
  });
});
