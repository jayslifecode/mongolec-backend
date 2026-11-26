import { Prisma } from '@prisma/client';
import { assertPermission } from '@/utils/permissions';

export const newsletterQueries = {
  // Get all subscriptions with filters
  getNewsletterSubscriptions: async (_: any, args: any, context: any) => {
    assertPermission(context, 'newsletter:manage');
    const { page = 1, limit = 20, status, search, orderBy = 'createdAt', orderDirection = 'desc' } = args;

    try {
      const where: Prisma.NewsletterSubscriptionWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
        ...(status && { status }),
        ...(search && {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const [subscriptions, total] = await Promise.all([
        context.prisma.newsletterSubscription.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { [orderBy]: orderDirection },
        }),
        context.prisma.newsletterSubscription.count({ where }),
      ]);

      return {
        subscriptions,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          perPage: limit,
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      console.error('Error fetching newsletter subscriptions:', error);
      throw new Error('Failed to fetch newsletter subscriptions');
    }
  },

  // Get single subscription by ID
  getNewsletterSubscription: async (_: any, args: any, context: any) => {
    assertPermission(context, 'newsletter:manage');
    const { id } = args;

    try {
      const subscription = await context.prisma.newsletterSubscription.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!subscription) {
        throw new Error('Newsletter subscription not found');
      }

      return subscription;
    } catch (error) {
      if (error instanceof Error && error.message === 'Newsletter subscription not found') throw error;
      console.error('Error fetching newsletter subscription:', error);
      throw new Error('Failed to fetch newsletter subscription');
    }
  },

  // Get subscription statistics
  getNewsletterStats: async (_: any, _args: any, context: any) => {
    assertPermission(context, 'newsletter:manage');
    try {
      const where: Prisma.NewsletterSubscriptionWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
      };

      const [
        totalSubscriptions,
        activeSubscriptions,
        unsubscribed,
        bounced,
      ] = await Promise.all([
        context.prisma.newsletterSubscription.count({ where }),
        context.prisma.newsletterSubscription.count({ where: { ...where, status: 'ACTIVE' } }),
        context.prisma.newsletterSubscription.count({ where: { ...where, status: 'UNSUBSCRIBED' } }),
        context.prisma.newsletterSubscription.count({ where: { ...where, status: 'BOUNCED' } }),
      ]);

      return {
        totalSubscriptions,
        activeSubscriptions,
        unsubscribed,
        bounced,
      };
    } catch (error) {
      console.error('Error fetching newsletter stats:', error);
      throw new Error('Failed to fetch newsletter stats');
    }
  },
};
