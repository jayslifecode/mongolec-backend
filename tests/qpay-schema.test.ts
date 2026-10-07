import { Prisma } from '@prisma/client';

describe('QPay Prisma schema', () => {
  it('exposes the Payment model and PaymentStatus enum', () => {
    const models = Prisma.dmmf.datamodel.models.map(m => m.name);
    expect(models).toContain('Payment');
    const paymentStatus = Prisma.dmmf.datamodel.enums.find(e => e.name === 'PaymentStatus');
    expect(paymentStatus?.values.map(v => v.name)).toEqual(
      expect.arrayContaining(['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED'])
    );
    const orderStatus = Prisma.dmmf.datamodel.enums.find(e => e.name === 'MerchOrderStatus');
    expect(orderStatus?.values.map(v => v.name)).toEqual(
      expect.arrayContaining(['AWAITING_PAYMENT', 'PAID', 'EXPIRED'])
    );
  });
});
