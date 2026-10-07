jest.mock('@/libs/qpay/qpay-service', () => ({
  createInvoiceForOrder: jest.fn(),
  expireIfLapsed: jest.fn().mockResolvedValue(undefined),
}));
import * as svc from '@/libs/qpay/qpay-service';
import { paymentMutations } from '@/graphql/resolvers/mutations/payment';
import { paymentQueries } from '@/graphql/resolvers/queries/payment';

function ctx(order: any) {
  return { prisma: { merchOrder: { findUnique: jest.fn().mockResolvedValue(order) } } } as any;
}

beforeEach(() => jest.clearAllMocks());

describe('qpay resolvers', () => {
  it('createQpayInvoice returns invoice display data', async () => {
    (svc.createInvoiceForOrder as jest.Mock).mockResolvedValue({
      orderId: 'o1',
      invoiceId: 'inv',
      qrText: 'QR',
      qrImage: 'img',
      shortUrl: 's',
      deeplinks: [],
      amount: 1000,
      currency: 'MNT',
      status: 'PENDING',
    });
    const res = await paymentMutations.createQpayInvoice(
      null,
      { orderId: 'o1' },
      ctx({ id: 'o1', status: 'AWAITING_PAYMENT' })
    );
    expect(res.invoiceId).toBe('inv');
  });

  it('createQpayInvoice throws when order missing', async () => {
    await expect(
      paymentMutations.createQpayInvoice(null, { orderId: 'nope' }, ctx(null))
    ).rejects.toThrow();
  });

  it('createQpayInvoice throws when order already paid', async () => {
    await expect(
      paymentMutations.createQpayInvoice(null, { orderId: 'o1' }, ctx({ id: 'o1', status: 'PAID' }))
    ).rejects.toThrow();
  });

  it('merchOrderPaymentStatus returns status from our DB', async () => {
    const context = {
      prisma: {
        merchOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', status: 'PAID' }) },
        payment: { findFirst: jest.fn().mockResolvedValue({ paidAt: new Date() }) },
      },
    } as any;
    const res = await paymentQueries.merchOrderPaymentStatus(null, { orderId: 'o1' }, context);
    expect(res.status).toBe('PAID');
    expect(svc.expireIfLapsed).toHaveBeenCalledWith(context.prisma, 'o1');
  });
});
