import { storyQueries } from '../src/graphql/resolvers/queries/story';

function buildContext(storyResult: any) {
  return {
    tenant: { id: 'tenant-1' },
    user: null,
    prisma: {
      story: {
        findFirst: jest.fn().mockResolvedValue(storyResult),
      },
    },
  } as any;
}

describe('Story public queries', () => {
  describe('getStory', () => {
    it('restricts unauthenticated callers to PUBLISHED stories', async () => {
      const context = buildContext({ id: 'story-1', status: 'PUBLISHED' });

      await storyQueries.getStory(null, { slug: 'mongolia-2024' }, context);

      const [{ where }] = context.prisma.story.findFirst.mock.calls[0];
      expect(where.status).toBe('PUBLISHED');
    });

    it('does not add a status filter for authenticated users', async () => {
      const context = buildContext({ id: 'story-1', status: 'DRAFT' });
      context.user = { id: 'admin-1' };

      await storyQueries.getStory(null, { slug: 'draft-story' }, context);

      const [{ where }] = context.prisma.story.findFirst.mock.calls[0];
      expect(where.status).toBeUndefined();
    });

    it('throws Story not found when the query returns nothing (e.g. DRAFT hidden)', async () => {
      const context = buildContext(null);

      await expect(storyQueries.getStory(null, { slug: 'hidden-draft' }, context)).rejects.toThrow(
        'Story not found'
      );
    });
  });
});
