import { GraphQLContext } from '@/types';
import { authenticated, withPermission } from '@/graphql/decorators/auth';
import { buildOrdersWorkbookBase64 } from '@/libs/order-export';

export interface ExportInput {
  orderIds?: string[];
  startDate?: string;
  endDate?: string;
  tenantId?: string;
}

/**
 * Build an .xlsx of orders and return it base64-encoded for the browser to
 * download. Accepts either an explicit set of orderIds (the "this page" export)
 * or a createdAt date range; tenant-scoped.
 */
export const exportMerchOrders = withPermission('merch:read')(
  authenticated(async (_parent: unknown, args: { input: ExportInput }, context: GraphQLContext) => {
    const { orderIds, startDate, endDate, tenantId } = args.input || {};

    const where: {
      id?: { in: string[] };
      createdAt?: { gte?: Date; lte?: Date };
      tenantId?: string;
    } = {};

    if (orderIds && orderIds.length) where.id = { in: orderIds };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    const effectiveTenant = tenantId ?? (context.user as { tenantId?: string })?.tenantId;
    if (effectiveTenant) where.tenantId = effectiveTenant;

    const orders = await context.prisma.merchOrder.findMany({
      where: where as never,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    const base64 = await buildOrdersWorkbookBase64(orders as never);
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `orders-${stamp}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64,
      count: orders.length,
    };
  })
);

export const orderExportMutations = { exportMerchOrders };
