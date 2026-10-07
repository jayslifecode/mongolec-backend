import { GraphQLContext } from '@/types';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { createInvoiceForOrder } from '@/libs/qpay/qpay-service';

/**
 * Guest-callable: creates (or reuses) a QPay invoice for an existing order.
 * The order id is the only handle a guest has — same pattern as the old
 * markMerchOrderPaid. Returns display-safe QR data only.
 */
export const createQpayInvoice = async (
  _parent: unknown,
  args: { orderId: string },
  context: GraphQLContext
) => {
  const order = await context.prisma.merchOrder.findUnique({ where: { id: args.orderId } });
  if (!order) throw new NotFoundError('Order');
  if (order.status === 'PAID') throw new ValidationError('Order is already paid');
  if (order.status === 'EXPIRED' || order.status === 'CANCELLED') {
    throw new ValidationError('Order can no longer be paid');
  }
  return createInvoiceForOrder(context.prisma, order as any);
};

export const paymentMutations = { createQpayInvoice };
