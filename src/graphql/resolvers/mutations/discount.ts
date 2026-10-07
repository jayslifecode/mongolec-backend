import { GraphQLContext } from '@/types';
import { authenticated, withPermission } from '@/graphql/decorators/auth';

const mapDiscount = (d: any) => ({
  ...d,
  productIds: (d.products || []).map((p: any) => p.id),
});

const connectProducts = (ids?: string[]) =>
  ids ? { connect: ids.map(id => ({ id })) } : undefined;
const setProducts = (ids?: string[]) => (ids ? { set: ids.map(id => ({ id })) } : undefined);

export const createMerchDiscount = withPermission('merch:create')(
  authenticated(async (_parent: unknown, args: { input: any }, context: GraphQLContext) => {
    const { productIds, ...rest } = args.input;
    const created = await context.prisma.merchDiscount.create({
      data: {
        ...rest,
        isActive: rest.isActive ?? true,
        tenantId: (context.user as any).tenantId,
        products: connectProducts(productIds),
      },
      include: { products: { select: { id: true } } },
    });
    return mapDiscount(created);
  })
);

export const updateMerchDiscount = withPermission('merch:update')(
  authenticated(
    async (_parent: unknown, args: { id: string; input: any }, context: GraphQLContext) => {
      const { productIds, ...upd } = args.input;
      const updated = await context.prisma.merchDiscount.update({
        where: { id: args.id },
        data: { ...upd, ...(productIds ? { products: setProducts(productIds) } : {}) },
        include: { products: { select: { id: true } } },
      });
      return mapDiscount(updated);
    }
  )
);

export const deleteMerchDiscount = withPermission('merch:delete')(
  authenticated(async (_parent: unknown, args: { id: string }, context: GraphQLContext) => {
    await context.prisma.merchDiscount.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
    });
    return true;
  })
);

export const discountMutations = {
  createMerchDiscount,
  updateMerchDiscount,
  deleteMerchDiscount,
};
