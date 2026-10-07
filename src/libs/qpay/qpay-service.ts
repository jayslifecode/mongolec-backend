import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { createInvoice, checkPayment, cancelInvoice } from '@/libs/qpay/qpay-client';
import { signOrderRef } from '@/libs/qpay/callback-token';

const logger = createLogger('QPAY_SERVICE');

export interface PaymentDisplay {
  orderId: string;
  invoiceId: string;
  qrText: string;
  qrImage: string;
  shortUrl?: string;
  deeplinks: unknown;
  amount: number;
  currency: string;
  status: string;
}

interface OrderLike {
  id: string;
  orderNumber: string;
  total: number;
  currency: string;
  tenantId: string;
  status: string;
}

function buildCallbackUrl(orderId: string): string {
  const token = signOrderRef(orderId);
  const base = config.qpay.callbackBaseUrl.replace(/\/$/, '');
  return `${base}/api/payments/qpay/callback?order=${encodeURIComponent(orderId)}&token=${token}`;
}

export async function createInvoiceForOrder(
  prisma: any,
  order: OrderLike
): Promise<PaymentDisplay> {
  if (order.status === 'PAID') throw new Error('Order is already paid');

  // Idempotent: reuse a live pending invoice if one exists and has not lapsed.
  const existing = await prisma.payment.findFirst({
    where: { orderId: order.id, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  if (
    existing &&
    (!existing.expiresAt || existing.expiresAt > new Date()) &&
    existing.qpayInvoiceId
  ) {
    return {
      orderId: order.id,
      invoiceId: existing.qpayInvoiceId,
      qrText: existing.qrText ?? '',
      qrImage: existing.qrImage ?? '',
      shortUrl: existing.shortUrl ?? undefined,
      deeplinks: existing.deeplinks ?? [],
      amount: existing.amount,
      currency: existing.currency,
      status: existing.status,
    };
  }

  const invoice = await createInvoice({
    senderInvoiceNo: order.orderNumber,
    amount: order.total,
    description: `Order ${order.orderNumber}`,
    callbackUrl: buildCallbackUrl(order.id),
  });

  const expiresAt = new Date(Date.now() + config.qpay.invoiceTtlMinutes * 60_000);
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      tenantId: order.tenantId,
      provider: 'QPAY',
      senderInvoiceNo: order.orderNumber,
      qpayInvoiceId: invoice.invoiceId,
      amount: order.total,
      currency: order.currency,
      status: 'PENDING',
      qrText: invoice.qrText,
      qrImage: invoice.qrImage,
      shortUrl: invoice.shortUrl ?? null,
      deeplinks: invoice.deeplinks as any,
      invoiceResponse: invoice.raw as any,
      expiresAt,
    },
  });

  logger.info(`Created QPay invoice ${invoice.invoiceId} for order ${order.orderNumber}`);
  return {
    orderId: order.id,
    invoiceId: invoice.invoiceId,
    qrText: invoice.qrText,
    qrImage: invoice.qrImage,
    shortUrl: invoice.shortUrl,
    deeplinks: invoice.deeplinks,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
  };
}

export async function confirmPayment(prisma: any, orderId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, status: { in: ['PENDING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment || !payment.qpayInvoiceId) {
    logger.warn(`confirmPayment: no pending payment for order ${orderId}`);
    return;
  }

  const check = await checkPayment(payment.qpayInvoiceId);
  const paidRow = check.rows.find(r => r.paymentStatus?.toUpperCase() === 'PAID');
  if (check.count < 1 || !paidRow) {
    logger.info(`confirmPayment: order ${orderId} not paid yet`);
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PAID',
      qpayPaymentId: paidRow.paymentId,
      paidAmount: check.paidAmount,
      fee: paidRow.fee,
      netAmount: paidRow.netAmount,
      paymentWallet: paidRow.wallet ?? null,
      paymentType: paidRow.paymentType ?? null,
      settlementStatus: paidRow.settlementStatus ?? null,
      ebarimtCustomerNo: paidRow.ebarimtCustomerNo ?? null,
      paidAt: new Date(),
      callbackPayload: check.raw as any,
    },
  });
  await prisma.merchOrder.update({ where: { id: orderId }, data: { status: 'PAID' } });

  // Deduct stock now that the order is paid. This runs exactly once because the
  // block above only executes on the PENDING -> PAID transition (a repeated
  // callback finds no PENDING payment and returns early).
  const items = await prisma.merchOrderItem.findMany({ where: { orderId } });
  for (const item of items) {
    const product = await prisma.merchProduct.findUnique({ where: { id: item.productId } });
    if (product?.trackInventory) {
      await prisma.merchProduct
        .update({
          where: { id: item.productId },
          data: { inventory: { decrement: item.quantity } },
        })
        .catch(e => logger.warn(`inventory decrement failed for ${item.productId}: ${String(e)}`));
    }
  }

  logger.info(`Order ${orderId} confirmed PAID (payment ${paidRow.paymentId}); stock deducted`);
}

export async function expireIfLapsed(prisma: any, orderId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment || !payment.expiresAt || payment.expiresAt > new Date()) return;

  if (payment.qpayInvoiceId) {
    await cancelInvoice(payment.qpayInvoiceId).catch(e =>
      logger.warn(`Failed to cancel expired invoice ${payment.qpayInvoiceId}: ${String(e)}`)
    );
  }

  // No inventory to restore: stock is only deducted on PAID (confirmPayment),
  // so an expiring unpaid order never touched inventory.

  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
  await prisma.merchOrder.update({ where: { id: orderId }, data: { status: 'EXPIRED' } });
  logger.info(`Order ${orderId} expired (invoice ${payment.qpayInvoiceId ?? 'n/a'})`);
}
