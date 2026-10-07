import { orderQueries } from '../src/graphql/resolvers/queries/order';

function adminContext() {
  return {
    prisma: {
      merchOrder: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'order-1', orderNumber: 'MEC-20260618-ABC123' }]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'order-1', orderNumber: 'MEC-20260618-ABC123' }),
      },
    },
    user: { id: 'admin-1', permissions: ['merch:read', 'merch:update'], roles: ['admin'] },
    tenant: { id: 'tenant-1' },
  } as any;
}

describe('order queries (admin)', () => {
  it('getMerchOrders returns orders for an authorized admin', async () => {
    const context = adminContext();
    const result = await orderQueries.getMerchOrders({}, { limit: 10, offset: 0 }, context);
    expect(result).toHaveLength(1);
    expect(context.prisma.merchOrder.findMany).toHaveBeenCalled();
  });

  it('getMerchOrders rejects an unauthenticated guest', async () => {
    const context = { prisma: {}, user: undefined } as any;
    await expect(orderQueries.getMerchOrders({}, {}, context)).rejects.toThrow();
  });

  it('getMerchOrders rejects a user lacking merch:read', async () => {
    const context = adminContext();
    context.user.permissions = [];
    await expect(orderQueries.getMerchOrders({}, {}, context)).rejects.toThrow();
  });

  it('getMerchOrderById returns a single order with items', async () => {
    const context = adminContext();
    const result = await orderQueries.getMerchOrderById({}, { id: 'order-1' }, context);
    expect(result?.id).toBe('order-1');
    expect(context.prisma.merchOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' } })
    );
  });
});
