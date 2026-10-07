import { GraphQLContext } from '@/types';
import { authenticated, withPermission } from '@/graphql/decorators/auth';

export const getMerchOrders = withPermission('merch:read')(
  authenticated(
    async (
      _parent: unknown,
      args: { status?: string; tenantId?: string; limit?: number; offset?: number },
      context: GraphQLContext
    ) => {
      const where: { status?: string; tenantId?: string } = {};
      if (args.status) where.status = args.status;
      if (args.tenantId) where.tenantId = args.tenantId;

      return context.prisma.merchOrder.findMany({
        where: where as any,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 50,
        skip: args.offset ?? 0,
      });
    }
  )
);

export const getMerchOrderById = withPermission('merch:read')(
  authenticated(async (_parent: unknown, args: { id: string }, context: GraphQLContext) => {
    return context.prisma.merchOrder.findUnique({
      where: { id: args.id },
      include: { items: true },
    });
  })
);

export const orderQueries = {
  getMerchOrders,
  getMerchOrderById,
};
