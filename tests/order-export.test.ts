import { buildOrdersWorkbookBase64 } from '../src/libs/order-export';
import { orderExportMutations } from '../src/graphql/resolvers/mutations/order-export';

const sampleOrder = {
  orderNumber: 'MEC-20260830-ABC123',
  createdAt: new Date('2026-08-30T10:00:00Z'),
  status: 'PAID',
  customerName: 'Test Customer',
  phone: '99001122',
  email: 'test@example.com',
  address: 'Ulaanbaatar',
  deliveryMethod: 'DELIVERY',
  paymentMethod: 'QPAY',
  subtotal: 24000,
  discountTotal: 6000,
  total: 24000,
  currency: 'MNT',
  items: [
    { name: 'JRP Metal Badge', variantName: null, quantity: 2, unitPrice: 12000 },
  ],
};

describe('buildOrdersWorkbookBase64', () => {
  it('produces a base64 xlsx (zip magic) for orders', async () => {
    const b64 = await buildOrdersWorkbookBase64([sampleOrder]);
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(100);
    // xlsx is a zip; zip files start with bytes "PK" -> base64 begins "UEsD"
    expect(b64.startsWith('UEsD')).toBe(true);
  });

  it('handles an empty order list', async () => {
    const b64 = await buildOrdersWorkbookBase64([]);
    expect(b64.startsWith('UEsD')).toBe(true);
  });
});

describe('exportMerchOrders resolver', () => {
  function ctx(orders: any[]) {
    return {
      prisma: { merchOrder: { findMany: jest.fn().mockResolvedValue(orders) } },
      user: { id: 'a', permissions: ['merch:read'], tenantId: 'tenant-1' },
      tenant: { id: 'tenant-1' },
    } as any;
  }

  it('returns a downloadable xlsx payload and count', async () => {
    const c = ctx([sampleOrder]);
    const res = await orderExportMutations.exportMerchOrders({}, { input: {} }, c);
    expect(res.count).toBe(1);
    expect(res.filename).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(res.mimeType).toContain('spreadsheetml');
    expect(res.base64.startsWith('UEsD')).toBe(true);
    // tenant-scoped by default
    expect(c.prisma.merchOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) })
    );
  });

  it('filters by orderIds when provided', async () => {
    const c = ctx([sampleOrder]);
    await orderExportMutations.exportMerchOrders({}, { input: { orderIds: ['o1', 'o2'] } }, c);
    expect(c.prisma.merchOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['o1', 'o2'] } }) })
    );
  });

  it('filters by date range when provided', async () => {
    const c = ctx([]);
    await orderExportMutations.exportMerchOrders(
      {},
      { input: { startDate: '2026-08-01T00:00:00Z', endDate: '2026-08-31T23:59:59Z' } },
      c
    );
    const arg = c.prisma.merchOrder.findMany.mock.calls[0][0];
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
    expect(arg.where.createdAt.lte).toBeInstanceOf(Date);
  });

  it('rejects a user lacking merch:read', async () => {
    const c = ctx([]);
    c.user.permissions = [];
    await expect(orderExportMutations.exportMerchOrders({}, { input: {} }, c)).rejects.toThrow();
  });
});
