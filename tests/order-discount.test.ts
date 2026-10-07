import { orderMutations } from '../src/graphql/resolvers/mutations/order';

function ctx() {
  const now = Date.now();
  const product = {
    id: 'p1',
    name: { en: 'Tee' },
    price: 100,
    currency: 'MNT',
    featuredImage: null,
    status: 'ACTIVE',
    deletedAt: null,
    trackInventory: false,
    allowBackorder: false,
    inventory: 10,
    tenantId: 'tenant-1',
    discounts: [
      {
        id: 'd',
        type: 'PERCENT',
        value: 20,
        isActive: true,
        startDate: new Date(now - 1000),
        endDate: new Date(now + 100000),
      },
    ],
  };
  const tx = {
    merchProduct: { findUnique: jest.fn().mockResolvedValue(product) },
    merchOrder: {
      create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 'o1', ...a.data })),
    },
  };
  const context = {
    prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
    tenant: { id: 'tenant-1' },
    user: undefined,
  } as any;
  context._tx = tx;
  return context;
}

it('createMerchOrder charges the discounted price and records discountTotal', async () => {
  const c = ctx();
  await orderMutations.createMerchOrder(
    {},
    {
      input: {
        customerName: 'A',
        phone: '1',
        address: 'x',
        items: [{ productId: 'p1', quantity: 2 }],
      },
    },
    c
  );
  const data = c._tx.merchOrder.create.mock.calls[0][0].data;
  expect(data.subtotal).toBe(160); // 80 * 2
  expect(data.total).toBe(160);
  expect(data.discountTotal).toBe(40); // (100-80) * 2
  const item = data.items.create[0];
  expect(item.unitPrice).toBe(80);
  expect(item.originalUnitPrice).toBe(100);
});
