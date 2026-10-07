jest.mock('@/config', () => ({
  config: {
    qpay: { callbackSecret: 's', callbackBaseUrl: 'https://api.x', invoiceTtlMinutes: 30 },
  },
}));
jest.mock('@/utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('@/libs/qpay/qpay-client', () => ({
  createInvoice: jest.fn(),
  checkPayment: jest.fn(),
  cancelInvoice: jest.fn(),
}));

import * as client from '@/libs/qpay/qpay-client';
import { createInvoiceForOrder, confirmPayment, expireIfLapsed } from '@/libs/qpay/qpay-service';

function makePrisma() {
  const payment = {
    id: 'pay-1',
    orderId: 'order-1',
    qpayInvoiceId: 'inv-1',
    status: 'PENDING',
    amount: 1000,
    currency: 'MNT',
    expiresAt: new Date(Date.now() + 60000),
  };
  return {
    _payment: payment,
    payment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockResolvedValue({ ...payment, status: 'PAID' }),
    },
    merchOrder: {
      findUnique: jest.fn().mockResolvedValue({ id: 'order-1', status: 'AWAITING_PAYMENT' }),
      update: jest.fn().mockResolvedValue({ id: 'order-1', status: 'PAID' }),
    },
    merchOrderItem: { findMany: jest.fn().mockResolvedValue([]) },
    merchProduct: { update: jest.fn().mockResolvedValue({}) },
  } as any;
}

const order = {
  id: 'order-1',
  orderNumber: 'MEC-1',
  total: 1000,
  currency: 'MNT',
  tenantId: 't1',
  status: 'AWAITING_PAYMENT',
};

beforeEach(() => jest.clearAllMocks());

describe('qpay-service', () => {
  it('creates an invoice, persists a Payment, returns display data', async () => {
    (client.createInvoice as jest.Mock).mockResolvedValue({
      invoiceId: 'inv-1',
      qrText: 'QR',
      qrImage: 'img',
      shortUrl: 's',
      deeplinks: [],
      raw: {},
    });
    const prisma = makePrisma();
    const res = await createInvoiceForOrder(prisma, order);
    expect(res.invoiceId).toBe('inv-1');
    expect(res.qrText).toBe('QR');
    expect(prisma.payment.create).toHaveBeenCalled();
    const callbackUrl = (client.createInvoice as jest.Mock).mock.calls[0][0].callbackUrl;
    expect(callbackUrl).toContain('order-1');
    expect(callbackUrl).toContain('token=');
  });

  it('confirmPayment marks order PAID when QPay reports paid', async () => {
    (client.checkPayment as jest.Mock).mockResolvedValue({
      count: 1,
      paidAmount: 1000,
      rows: [{ paymentId: 'p9', paymentStatus: 'PAID', paymentAmount: 1000 }],
      raw: {},
    });
    const prisma = makePrisma();
    prisma.payment.findFirst.mockResolvedValue(prisma._payment);
    await confirmPayment(prisma, 'order-1');
    expect(prisma.merchOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) })
    );
  });

  it('confirmPayment decrements stock for paid items', async () => {
    (client.checkPayment as jest.Mock).mockResolvedValue({
      count: 1,
      paidAmount: 1000,
      rows: [{ paymentId: 'p9', paymentStatus: 'PAID', paymentAmount: 1000 }],
      raw: {},
    });
    const prisma = makePrisma();
    prisma.payment.findFirst.mockResolvedValue(prisma._payment);
    prisma.merchOrderItem.findMany.mockResolvedValue([{ productId: 'prod-1', quantity: 3 }]);
    prisma.merchProduct.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'prod-1', trackInventory: true });
    await confirmPayment(prisma, 'order-1');
    expect(prisma.merchProduct.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { inventory: { decrement: 3 } },
    });
  });

  it('confirmPayment is a no-op when QPay reports unpaid', async () => {
    (client.checkPayment as jest.Mock).mockResolvedValue({
      count: 0,
      paidAmount: 0,
      rows: [],
      raw: {},
    });
    const prisma = makePrisma();
    prisma.payment.findFirst.mockResolvedValue(prisma._payment);
    await confirmPayment(prisma, 'order-1');
    expect(prisma.merchOrder.update).not.toHaveBeenCalled();
  });

  it('expireIfLapsed cancels the invoice and expires order past TTL', async () => {
    (client.cancelInvoice as jest.Mock).mockResolvedValue(undefined);
    const prisma = makePrisma();
    prisma.payment.findFirst.mockResolvedValue({
      ...prisma._payment,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expireIfLapsed(prisma, 'order-1');
    expect(client.cancelInvoice).toHaveBeenCalledWith('inv-1');
    expect(prisma.merchOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) })
    );
  });
});
