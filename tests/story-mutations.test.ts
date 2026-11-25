import { Prisma } from '@prisma/client';
import { storyMutations } from '../src/graphql/resolvers/mutations/story';

// Every story action failed in production: they wrote `authorId` and included an `author`
// relation, but Story.author is a JSON name and there is no authorId. These tests check each
// call against the real Story model, so a field that does not exist fails here, not in prod.
const storyModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'Story')!;
const storyFields = new Set(storyModel.fields.map(f => f.name));
const storyRelations = new Set(storyModel.fields.filter(f => f.kind === 'object').map(f => f.name));

function buildContext() {
  const existing = { id: 's1', slug: 'old', status: 'DRAFT', featured: false, tenantId: 't1' };
  return {
    user: { id: 'u1', tenantId: 't1', roles: ['super_admin'], permissions: [] },
    tenant: { id: 't1' },
    prisma: {
      story: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(existing),
      },
    },
  } as any;
}

function expectValidWrites(context: any) {
  const calls = [
    ...context.prisma.story.create.mock.calls,
    ...context.prisma.story.update.mock.calls,
  ];
  expect(calls.length).toBeGreaterThan(0);
  for (const [args] of calls) {
    for (const key of Object.keys(args.data ?? {})) expect(storyFields).toContain(key);
    for (const key of Object.keys(args.include ?? {})) expect(storyRelations).toContain(key);
  }
}

const input = { title: { en: 'T' }, slug: 'new', content: { blocks: [] }, type: 'UPDATE' };

describe('story mutations only use fields the Story model has', () => {
  it('createStory', async () => {
    const context = buildContext();
    await storyMutations.createStory(null, { data: input }, context);
    expectValidWrites(context);
  });

  it('updateStory', async () => {
    const context = buildContext();
    await storyMutations.updateStory(null, { id: 's1', data: { title: { en: 'T2' } } }, context);
    expectValidWrites(context);
  });

  it.each(['publishStory', 'unpublishStory', 'toggleStoryFeatured', 'deleteStory'] as const)(
    '%s',
    async name => {
      const context = buildContext();
      await (storyMutations as any)[name](null, { id: 's1' }, context);
      expectValidWrites(context);
    }
  );
});
