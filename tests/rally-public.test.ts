import { rallyQueries } from '../src/graphql/resolvers/queries/rally';

function buildContext(rallyFindManyResult: any[] = [], count = 0) {
  return {
    tenant: { id: 'tenant-1' },
    user: null,
    prisma: {
      rally: {
        findMany: jest.fn().mockResolvedValue(rallyFindManyResult),
        count: jest.fn().mockResolvedValue(count),
      },
    },
  } as any;
}

describe('Rally public queries', () => {
  describe('getRecruitingRallies', () => {
    it('filters by isRecruiting, status, deadline, and excludes placeholders', async () => {
      const context = buildContext([]);

      await rallyQueries.getRecruitingRallies(null, {}, context);

      const [{ where, orderBy }] = context.prisma.rally.findMany.mock.calls[0];

      expect(where.isRecruiting).toBe(true);
      expect(where.status).toEqual({ in: ['UPCOMING', 'ONGOING'] });
      expect(where.isPlaceholder).toBe(false);
      expect(where.OR).toEqual([
        { applicationDeadline: null },
        { applicationDeadline: { gte: expect.any(Date) } },
      ]);
      expect(orderBy).toEqual({ startDate: 'asc' });
    });

    it('does not require authentication', async () => {
      const context = buildContext([{ id: 'rally-1' }]);
      delete context.user;

      const result = await rallyQueries.getRecruitingRallies(null, {}, context);

      expect(result).toEqual([{ id: 'rally-1' }]);
    });
  });

  describe('getUpcomingRallies', () => {
    it('includes placeholder rallies and orders by startDate asc', async () => {
      const placeholderRally = { id: 'rally-placeholder', isPlaceholder: true, status: 'UPCOMING' };
      const context = buildContext([placeholderRally], 1);

      const result = await rallyQueries.getUpcomingRallies(null, {}, context);

      const [{ where, orderBy }] = context.prisma.rally.findMany.mock.calls[0];
      expect(where.isPlaceholder).toBeUndefined();
      expect(where.status).toEqual({ in: ['UPCOMING', 'ONGOING'] });
      expect(orderBy).toEqual({ startDate: 'asc' });
      expect(result.rallies).toContainEqual(placeholderRally);
    });
  });

  describe('getPastRallies', () => {
    it('orders by startDate desc and filters COMPLETED only', async () => {
      const context = buildContext([], 0);

      await rallyQueries.getPastRallies(null, {}, context);

      const [{ where, orderBy }] = context.prisma.rally.findMany.mock.calls[0];
      expect(where.status).toBe('COMPLETED');
      expect(orderBy).toEqual({ startDate: 'desc' });
    });
  });
});
