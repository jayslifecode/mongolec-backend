import { discountQueries } from '../src/graphql/resolvers/queries/discount';

function ctx() {
  return {
    prisma: {
      merchDiscount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'd1',
            name: 'Summer',
            type: 'PERCENT',
            value: 10,
            isActive: true,
            startDate: new Date(),
            endDate: new Date(),
            products: [{ id: 'p1' }],
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'd1',
          name: 'Summer',
          type: 'PERCENT',
          value: 10,
          isActive: true,
          startDate: new Date(),
          endDate: new Date(),
          products: [{ id: 'p1' }],
        }),
      },
    },
    user: { id: 'a', permissions: ['merch:read'], tenantId: 'tenant-1' },
    tenant: { id: 'tenant-1' },
  } as any;
}

describe('discount queries', () => {
  it('getMerchDiscounts returns tenant discounts with productIds', async () => {
    const c = ctx();
    const res = await discountQueries.getMerchDiscounts({}, { limit: 10 }, c);
    expect(res[0].productIds).toEqual(['p1']);
    expect(c.prisma.merchDiscount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null, tenantId: 'tenant-1' }),
      })
    );
  });

  it('rejects a user lacking merch:read', async () => {
    const c = ctx();
    c.user.permissions = [];
    await expect(discountQueries.getMerchDiscounts({}, {}, c)).rejects.toThrow();
  });

  it('getMerchDiscountById returns one with productIds', async () => {
    const c = ctx();
    const res = await discountQueries.getMerchDiscountById({}, { id: 'd1' }, c);
    expect(res?.id).toBe('d1');
    expect(res?.productIds).toEqual(['p1']);
  });
});
