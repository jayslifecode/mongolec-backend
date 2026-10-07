import { orderMutations } from '../src/graphql/resolvers/mutations/order';

function buildContext(overrides: any = {}) {
  const product = {
    id: 'prod-1',
    name: { en: 'Test Tee', mn: 'Тест' },
    price: 100,
    currency: 'MNT',
    inventory: 10,
    trackInventory: true,
    allowBackorder: false,
    status: 'ACTIVE',
    featuredImage: 'https://cdn/img.jpg',
    tenantId: 'tenant-1',
    deletedAt: null,
    ...overrides.product,
  };
  const tx = {
    merchProduct: {
      findUnique: jest.fn().mockResolvedValue(product),
      update: jest.fn().mockResolvedValue({ ...product, inventory: product.inventory - 1 }),
    },
    merchOrder: {
      create: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'order-1', ...data, items: data.items?.create ?? [] })
        ),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    merchOrder: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'order-1', orderNumber: 'MEC-20260619-ABC123' }),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'order-1', orderNumber: 'MEC-20260619-ABC123', ...data, items: [] })
        ),
    },
  };
  return {
    context: { prisma, user: undefined, tenant: { id: 'tenant-1' }, ...overrides.context } as any,
    tx,
    prisma,
    product,
  };
}

const validInput = {
  customerName: 'Bat',
  phone: '99001122',
  address: 'UB, Khan-Uul',
  items: [{ productId: 'prod-1', quantity: 2 }],
};

describe('createMerchOrder', () => {
  it('creates an order for a guest and snapshots product data', async () => {
    const { context, tx } = buildContext();
    const order = await orderMutations.createMerchOrder({}, { input: validInput }, context);
    expect(order.orderNumber).toMatch(/^MEC-\d{8}-[A-Z0-9]{6}$/);
    expect(order.userId).toBeNull();
    expect(order.subtotal).toBe(200);
    expect(order.total).toBe(200);
    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(order.paymentMethod).toBe('QPAY');
    const createArg = tx.merchOrder.create.mock.calls[0][0].data;
    expect(createArg.items.create[0]).toMatchObject({
      productId: 'prod-1',
      name: 'Test Tee',
      image: 'https://cdn/img.jpg',
      unitPrice: 100,
      quantity: 2,
    });
  });

  it('derives tenantId from the product when context has no tenant', async () => {
    const { context, tx } = buildContext({
      context: { tenant: undefined },
      product: { tenantId: 'tenant-from-product' },
    });
    await orderMutations.createMerchOrder({}, { input: validInput }, context);
    const createArg = tx.merchOrder.create.mock.calls[0][0].data;
    expect(createArg.tenantId).toBe('tenant-from-product');
  });

  it('does NOT decrement inventory at order creation (pay-first flow)', async () => {
    const { context, tx } = buildContext();
    await orderMutations.createMerchOrder({}, { input: validInput }, context);
    // Stock is only reduced on payment confirmation, not when the order is placed.
    expect(tx.merchProduct.update).not.toHaveBeenCalled();
  });

  it('defaults deliveryMethod to DELIVERY', async () => {
    const { context, tx } = buildContext();
    await orderMutations.createMerchOrder({}, { input: validInput }, context);
    expect(tx.merchOrder.create.mock.calls[0][0].data.deliveryMethod).toBe('DELIVERY');
  });

  it('allows a PICKUP order without a delivery address', async () => {
    const { context, tx } = buildContext();
    const order = await orderMutations.createMerchOrder(
      {},
      { input: { ...validInput, address: undefined, deliveryMethod: 'PICKUP' } },
      context
    );
    expect(order.deliveryMethod).toBe('PICKUP');
    expect(tx.merchOrder.create.mock.calls[0][0].data.deliveryMethod).toBe('PICKUP');
  });

  it('rejects an empty cart', async () => {
    const { context } = buildContext();
    await expect(
      orderMutations.createMerchOrder({}, { input: { ...validInput, items: [] } }, context)
    ).rejects.toThrow('Cart is empty');
  });

  it('rejects a missing customer name', async () => {
    const { context } = buildContext();
    await expect(
      orderMutations.createMerchOrder({}, { input: { ...validInput, customerName: '  ' } }, context)
    ).rejects.toThrow('Customer name is required');
  });

  it('rejects an inactive product', async () => {
    const { context } = buildContext({ product: { status: 'DRAFT' } });
    await expect(
      orderMutations.createMerchOrder({}, { input: validInput }, context)
    ).rejects.toThrow('not available');
  });

  it('rejects insufficient stock', async () => {
    const { context } = buildContext({ product: { inventory: 1 } });
    await expect(
      orderMutations.createMerchOrder({}, { input: validInput }, context)
    ).rejects.toThrow('Insufficient stock');
  });

  it('throws NotFound when product is missing', async () => {
    const { context, tx } = buildContext();
    tx.merchProduct.findUnique.mockResolvedValueOnce(null);
    await expect(
      orderMutations.createMerchOrder({}, { input: validInput }, context)
    ).rejects.toThrow('not found');
  });
});

describe('updateMerchOrderStatus', () => {
  function adminCtx() {
    return {
      prisma: {
        merchOrder: {
          update: jest.fn().mockResolvedValue({ id: 'order-1', status: 'CONFIRMED', items: [] }),
        },
      },
      user: { id: 'admin-1', permissions: ['merch:update'], roles: ['admin'] },
    } as any;
  }

  it('updates an order status for an authorized admin', async () => {
    const context = adminCtx();
    const result = await orderMutations.updateMerchOrderStatus(
      {},
      { id: 'order-1', status: 'CONFIRMED' },
      context
    );
    expect(result.status).toBe('CONFIRMED');
    expect(context.prisma.merchOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' }, data: { status: 'CONFIRMED' } })
    );
  });

  it('rejects an invalid status value', async () => {
    const context = adminCtx();
    await expect(
      orderMutations.updateMerchOrderStatus({}, { id: 'order-1', status: 'BOGUS' }, context)
    ).rejects.toThrow('Invalid status');
  });

  it('rejects a user lacking merch:update', async () => {
    const context = adminCtx();
    context.user.permissions = [];
    await expect(
      orderMutations.updateMerchOrderStatus({}, { id: 'order-1', status: 'CONFIRMED' }, context)
    ).rejects.toThrow();
  });
});
