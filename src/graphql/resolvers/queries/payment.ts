import { GraphQLContext } from '@/types';
import { NotFoundError } from '@/utils/errors';
import { expireIfLapsed } from '@/libs/qpay/qpay-service';

/**
 * Guest-callable: the frontend polls THIS (our DB) for payment status after
 * showing the QR — it never calls QPay directly. Lazily expires a lapsed
 * invoice on read so no cron is needed.
 */
export const merchOrderPaymentStatus = async (
  _parent: unknown,
  args: { orderId: string },
  context: GraphQLContext
) => {
  await expireIfLapsed(context.prisma, args.orderId);
  const order = await context.prisma.merchOrder.findUnique({ where: { id: args.orderId } });
  if (!order) throw new NotFoundError('Order');
  const paid = await context.prisma.payment.findFirst({
    where: { orderId: args.orderId, status: 'PAID' },
    orderBy: { paidAt: 'desc' },
  });
  return { orderId: order.id, status: order.status, paidAt: paid?.paidAt ?? null };
};

export const paymentQueries = { merchOrderPaymentStatus };
