import { discountMutations } from '../src/graphql/resolvers/mutations/discount';

function ctx(overrides: any = {}) {
  return {
    prisma: {
      merchDiscount: {
        create: jest.fn().mockResolvedValue({ id: 'd1', products: [] }),
        update: jest.fn().mockResolvedValue({ id: 'd1', products: [] }),
      },
    },
    user: {
      id: 'a',
      permissions: ['merch:create', 'merch:update', 'merch:delete'],
      tenantId: 'tenant-1',
    },
    tenant: { id: 'tenant-1' },
    ...overrides,
  } as any;
}

describe('discount mutations', () => {
  it('createMerchDiscount sets tenantId from context and connects products', async () => {
    const c = ctx();
    await discountMutations.createMerchDiscount(
      {},
      {
        input: {
          name: 'Summer',
          type: 'PERCENT',
          value: 10,
          startDate: new Date(),
          endDate: new Date(),
          productIds: ['p1', 'p2'],
        },
      },
      c
    );
    expect(c.prisma.merchDiscount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          products: { connect: [{ id: 'p1' }, { id: 'p2' }] },
        }),
      })
    );
  });

  it('updateMerchDiscount uses set for productIds', async () => {
    const c = ctx();
    await discountMutations.updateMerchDiscount({}, { id: 'd1', input: { productIds: ['p3'] } }, c);
    expect(c.prisma.merchDiscount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({ products: { set: [{ id: 'p3' }] } }),
      })
    );
  });

  it('deleteMerchDiscount soft-deletes', async () => {
    const c = ctx();
    c.prisma.merchDiscount.update = jest.fn().mockResolvedValue({ id: 'd1' });
    const ok = await discountMutations.deleteMerchDiscount({}, { id: 'd1' }, c);
    expect(ok).toBe(true);
    expect(c.prisma.merchDiscount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'd1' }, data: { deletedAt: expect.any(Date) } })
    );
  });

  it('rejects create without merch:create', async () => {
    const c = ctx();
    c.user.permissions = [];
    await expect(discountMutations.createMerchDiscount({}, { input: {} }, c)).rejects.toThrow();
  });
});
