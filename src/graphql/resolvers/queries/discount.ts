import { GraphQLContext } from '@/types';
import { authenticated, withPermission } from '@/graphql/decorators/auth';

const mapDiscount = (d: any) => ({
  ...d,
  productIds: (d.products || []).map((p: any) => p.id),
});

async function resolveTenantId(
  args: { tenantId?: string; tenantSlug?: string },
  context: GraphQLContext
): Promise<string | undefined> {
  if (args.tenantId) return args.tenantId;
  if (args.tenantSlug) {
    const tenant = await context.prisma.tenant.findUnique({ where: { slug: args.tenantSlug } });
    return tenant?.id;
  }
  return (context.user as any)?.tenantId;
}

export const getMerchDiscounts = withPermission('merch:read')(
  authenticated(
    async (
      _parent: unknown,
      args: {
        tenantId?: string;
        tenantSlug?: string;
        isActive?: boolean;
        limit?: number;
        offset?: number;
      },
      context: GraphQLContext
    ) => {
      const where: any = { deletedAt: null };
      const tenantId = await resolveTenantId(args, context);
      if (tenantId) where.tenantId = tenantId;
      if (args.isActive !== undefined) where.isActive = args.isActive;

      const rows = await context.prisma.merchDiscount.findMany({
        where,
        include: { products: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 50,
        skip: args.offset ?? 0,
      });
      return rows.map(mapDiscount);
    }
  )
);

export const getMerchDiscountById = withPermission('merch:read')(
  authenticated(async (_parent: unknown, args: { id: string }, context: GraphQLContext) => {
    const row = await context.prisma.merchDiscount.findUnique({
      where: { id: args.id },
      include: { products: { select: { id: true } } },
    });
    return row ? mapDiscount(row) : null;
  })
);

export const discountQueries = {
  getMerchDiscounts,
  getMerchDiscountById,
};
