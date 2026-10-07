import { GraphQLContext } from '@/types';
import { ValidationError, NotFoundError } from '@/utils/errors';
import { generateRandomString } from '@/utils/index';
import { getLocalizedContent } from '@/libs/localization';
import { createLogger } from '@/utils/logger';
import { authenticated, withPermission } from '@/graphql/decorators/auth';
import { resolveActiveDiscount } from '@/libs/discounts';

const VALID_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
const VALID_DELIVERY_METHODS = ['DELIVERY', 'PICKUP'];

const logger = createLogger('MERCH_ORDER_MUTATIONS');

export interface CreateMerchOrderItemInput {
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  quantity: number;
}

export interface CreateMerchOrderInput {
  customerName: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  currency?: string | null;
  tenantId?: string | null;
  deliveryMethod?: string | null;
  items: CreateMerchOrderItemInput[];
}

export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `MEC-${date}-${generateRandomString(6).toUpperCase()}`;
}

export const createMerchOrder = async (
  _parent: unknown,
  args: { input: CreateMerchOrderInput },
  context: GraphQLContext
) => {
  const { input } = args;

  const deliveryMethod = (input.deliveryMethod || 'DELIVERY').toUpperCase();
  if (!VALID_DELIVERY_METHODS.includes(deliveryMethod)) {
    throw new ValidationError(`Invalid delivery method: ${input.deliveryMethod}`);
  }

  if (!input.customerName?.trim()) throw new ValidationError('Customer name is required');
  if (!input.phone?.trim()) throw new ValidationError('Phone is required');
  // A delivery address is only required when the order is being shipped; office
  // pickup orders do not need one.
  if (deliveryMethod === 'DELIVERY' && !input.address?.trim()) {
    throw new ValidationError('Delivery address is required');
  }
  if (!input.items?.length) throw new ValidationError('Cart is empty');

  // Tenant is taken from the request context or explicit input, and otherwise
  // derived from the ordered products themselves (a guest storefront does not
  // know the real tenant id). Resolved inside the transaction once products load.
  let tenantId = context.tenant?.id || input.tenantId || undefined;

  try {
    const order = await (context.prisma as any).$transaction(async (tx: any) => {
      let subtotal = 0;
      let discountTotal = 0;
      const itemsData: any[] = [];

      for (const item of input.items) {
        if (!item.quantity || item.quantity < 1) {
          throw new ValidationError('Item quantity must be at least 1');
        }
        const product = await tx.merchProduct.findUnique({
          where: { id: item.productId },
          include: { discounts: { where: { deletedAt: null, isActive: true } } },
        });
        if (!product || product.deletedAt) throw new NotFoundError('Merchandise product');
        if (product.status !== 'ACTIVE') {
          throw new ValidationError(`Product is not available: ${item.productId}`);
        }
        if (!tenantId) tenantId = product.tenantId;
        if (
          product.trackInventory &&
          !product.allowBackorder &&
          product.inventory < item.quantity
        ) {
          throw new ValidationError(`Insufficient stock for product: ${item.productId}`);
        }

        const basePrice = product.price;
        const discount = resolveActiveDiscount(
          basePrice,
          (product as any).discounts || [],
          new Date()
        );
        const unitPrice = discount ? discount.discountedPrice : basePrice;
        subtotal += unitPrice * item.quantity;
        discountTotal += (basePrice - unitPrice) * item.quantity;
        itemsData.push({
          productId: product.id,
          name: getLocalizedContent(product.name, 'en') || '',
          image: product.featuredImage ?? null,
          variantId: item.variantId ?? null,
          variantName: item.variantName ?? null,
          unitPrice,
          originalUnitPrice: basePrice,
          quantity: item.quantity,
        });

        // Inventory is NOT decremented here. In the QPay pay-first flow the
        // order is created as AWAITING_PAYMENT; stock is only reduced once the
        // payment is confirmed (see confirmPayment). This keeps abandoned /
        // unpaid orders from holding inventory.
      }

      const total = subtotal;

      if (!tenantId) throw new ValidationError('Tenant could not be determined for this order');

      return tx.merchOrder.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId: context.user?.id ?? null,
          customerName: input.customerName.trim(),
          phone: input.phone.trim(),
          email: input.email ?? null,
          address: input.address?.trim() || (deliveryMethod === 'PICKUP' ? 'Office pickup' : ''),
          notes: input.notes ?? null,
          status: 'AWAITING_PAYMENT',
          paymentMethod: 'QPAY',
          deliveryMethod,
          subtotal,
          discountTotal,
          total,
          currency: input.currency ?? 'MNT',
          tenantId,
          items: { create: itemsData },
        },
        include: { items: true },
      });
    });

    return order;
  } catch (error) {
    logger.error('createMerchOrder failed', error as Error);
    throw error;
  }
};

export const updateMerchOrderStatus = withPermission('merch:update')(
  authenticated(
    async (_parent: unknown, args: { id: string; status: string }, context: GraphQLContext) => {
      if (!VALID_ORDER_STATUSES.includes(args.status)) {
        throw new ValidationError(`Invalid status: ${args.status}`);
      }
      return context.prisma.merchOrder.update({
        where: { id: args.id },
        data: { status: args.status as any },
        include: { items: true },
      });
    }
  )
);

export const orderMutations = {
  createMerchOrder,
  updateMerchOrderStatus,
};
