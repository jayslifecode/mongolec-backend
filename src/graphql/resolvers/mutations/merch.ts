import { GraphQLContext } from '@/types';
import { createLogger } from '@/utils/logger';
import { slugify } from '@/utils/index';
import { authenticated, withPermission } from '@/graphql/decorators/auth';
import { NotFoundError, ValidationError } from '@/utils/errors';
import type {
  CreateMerchProductArgs,
  UpdateMerchProductArgs,
  DeleteMerchProductArgs,
  MerchProductInput,
  CreateMerchCategoryArgs,
  UpdateMerchCategoryArgs,
} from '@/graphql/types/args';

const logger = createLogger('MERCH_MUTATIONS');

// Permission constants
const PERMISSIONS = {
  CREATE_PRODUCT: 'merch:create',
  UPDATE_PRODUCT: 'merch:update',
  DELETE_PRODUCT: 'merch:delete',
  CREATE_CATEGORY: 'merch:category:create',
  UPDATE_CATEGORY: 'merch:category:update',
  DELETE_CATEGORY: 'merch:category:delete',
} as const;

/**
 * Merch Mutation Resolvers
 * Handles merchandise product and category mutations with authentication
 */
export const merchMutations = {
  /**
   * Create new merchandise product
   */
  createMerchProduct: withPermission(PERMISSIONS.CREATE_PRODUCT)(
    authenticated(
      async (_parent: unknown, args: CreateMerchProductArgs, context: GraphQLContext) => {
        try {
          const { input } = args;

          // Extract variants and discount ids from input
          const { variants, discountIds, ...productData } = input;

          // Generate slug if not provided
          const slug =
            productData.slug ||
            slugify(
              typeof productData.name === 'string'
                ? productData.name
                : productData.name.en || 'product'
            );

          // Set published date if status is ACTIVE and no date provided
          const publishedAt =
            productData.status === 'ACTIVE' && !productData.publishedAt
              ? new Date()
              : productData.publishedAt;

          const product = await context.prisma.merchProduct.create({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: {
              ...productData,
              slug,
              publishedAt,
              tenantId: context.user.tenantId,
              createdById: context.user.id,
              discounts: discountIds
                ? { connect: discountIds.map((did: string) => ({ id: did })) }
                : undefined,
              productVariants:
                variants && variants.length > 0
                  ? {
                      create: variants.map((variant: any, index: number) => ({
                        ...variant,
                        position: variant.position ?? index,
                        inventory: variant.inventory ?? 0,
                        isAvailable: variant.isAvailable ?? true,
                      })),
                    }
                  : undefined,
            } as any,
            include: {
              category: true,
              tenant: true,
              productVariants: {
                where: { deletedAt: null },
                orderBy: { position: 'asc' },
              },
            },
          });

          logger.info(`Created merch product: ${product.id}`, { userId: context.user.id });
          return product;
        } catch (error) {
          logger.error('Error creating merch product', error as Error);
          throw error;
        }
      }
    )
  ),

  /**
   * Update existing merchandise product
   */
  updateMerchProduct: withPermission(PERMISSIONS.UPDATE_PRODUCT)(
    authenticated(
      async (_parent: unknown, args: UpdateMerchProductArgs, context: GraphQLContext) => {
        try {
          const { id, input } = args;

          // Check if product exists
          const existingProduct = await context.prisma.merchProduct.findUnique({
            where: { id },
          });

          if (!existingProduct || existingProduct.deletedAt) {
            throw new NotFoundError('Merchandise product');
          }

          // Extract variants and discount ids from input
          const { variants, discountIds, ...productData } = input;

          // Update slug if name changed
          const updateData: any = { ...productData };
          if (productData.name && !productData.slug) {
            updateData.slug = slugify(
              typeof productData.name === 'string'
                ? productData.name
                : productData.name.en || 'product'
            );
          }

          // Set published date if status changed to ACTIVE
          if (
            productData.status === 'ACTIVE' &&
            existingProduct.status !== 'ACTIVE' &&
            !productData.publishedAt
          ) {
            updateData.publishedAt = new Date();
          }

          // Set updated by user
          updateData.updatedById = context.user.id;

          // Handle variant updates
          // If variants are provided, delete existing and create new ones
          if (variants !== undefined) {
            // Delete existing variants
            await context.prisma.merchVariant.deleteMany({
              where: { productId: id },
            });

            // Create new variants if provided
            if (variants && variants.length > 0) {
              updateData.productVariants = {
                create: variants.map((variant: any, index: number) => ({
                  ...variant,
                  position: variant.position ?? index,
                  inventory: variant.inventory ?? 0,
                  isAvailable: variant.isAvailable ?? true,
                })),
              };
            }
          }

          if (discountIds) {
            updateData.discounts = { set: discountIds.map((did: string) => ({ id: did })) };
          }

          const product = await context.prisma.merchProduct.update({
            where: { id },
            data: updateData,
            include: {
              category: true,
              tenant: true,
              productVariants: {
                where: { deletedAt: null },
                orderBy: { position: 'asc' },
              },
            },
          });

          logger.info(`Updated merch product: ${product.id}`, { userId: context.user.id });
          return product;
        } catch (error) {
          logger.error('Error updating merch product', error as Error);
          throw error;
        }
      }
    )
  ),

  /**
   * Delete merchandise product (soft delete)
   */
  deleteMerchProduct: withPermission(PERMISSIONS.DELETE_PRODUCT)(
    authenticated(
      async (_parent: unknown, args: DeleteMerchProductArgs, context: GraphQLContext) => {
        try {
          const { id } = args;

          const product = await context.prisma.merchProduct.findUnique({
            where: { id },
          });

          if (!product || product.deletedAt) {
            throw new NotFoundError('Merchandise product');
          }

          await context.prisma.merchProduct.update({
            where: { id },
            data: {
              deletedAt: new Date(),
              updatedById: context.user.id,
            },
          });

          logger.info(`Deleted merch product: ${id}`, { userId: context.user.id });
          return true;
        } catch (error) {
          logger.error('Error deleting merch product', error as Error);
          throw error;
        }
      }
    )
  ),

  /**
   * Create individual merchandise variant
   */
  createMerchVariant: withPermission(PERMISSIONS.CREATE_PRODUCT)(
    authenticated(
      async (
        _parent: unknown,
        args: { productId: string; input: any },
        context: GraphQLContext
      ) => {
        try {
          const { productId, input } = args;

          // Check if product exists
          const product = await context.prisma.merchProduct.findUnique({
            where: { id: productId },
          });

          if (!product || product.deletedAt) {
            throw new NotFoundError('Product');
          }

          const variant = await context.prisma.merchVariant.create({
            data: {
              ...input,
              productId,
              inventory: input.inventory ?? 0,
              isAvailable: input.isAvailable ?? true,
            },
          });

          logger.info(`Created variant: ${variant.id} for product: ${productId}`, {
            userId: context.user.id,
          });
          return variant;
        } catch (error) {
          logger.error('Error creating variant', error as Error);
          throw error;
        }
      }
    )
  ),

  /**
   * Update merchandise variant
   */
  updateMerchVariant: withPermission(PERMISSIONS.UPDATE_PRODUCT)(
    authenticated(
      async (_parent: unknown, args: { id: string; input: any }, context: GraphQLContext) => {
        try {
          const { id, input } = args;

          const variant = await context.prisma.merchVariant.update({
            where: { id },
            data: input,
          });

          logger.info(`Updated variant: ${variant.id}`, { userId: context.user.id });
          return variant;
        } catch (error) {
          logger.error('Error updating variant', error as Error);
          throw error;
        }
      }
    )
  ),

  /**
   * Delete merchandise variant
   */
  deleteMerchVariant: withPermission(PERMISSIONS.DELETE_PRODUCT)(
    authenticated(async (_parent: unknown, args: { id: string }, context: GraphQLContext) => {
      try {
        const { id } = args;

        await context.prisma.merchVariant.update({
          where: { id },
          data: { deletedAt: new Date() },
        });

        logger.info(`Deleted variant: ${id}`, { userId: context.user.id });
        return true;
      } catch (error) {
        logger.error('Error deleting variant', error as Error);
        throw error;
      }
    })
  ),

  /**
   * Create new merchandise category
   */
  createMerchCategory: withPermission(PERMISSIONS.CREATE_CATEGORY)(
    authenticated(
      async (_parent: unknown, args: CreateMerchCategoryArgs, context: GraphQLContext) => {
        try {
          const { input } = args;

          // Generate slug if not provided
          const slug =
            input.slug ||
            slugify(typeof input.name === 'string' ? input.name : input.name.en || 'category');

          const category = await context.prisma.merchCategory.create({
            data: {
              ...input,
              slug,
              tenantId: context.user.tenantId,
            },
            include: {
              products: true,
              parent: true,
              children: true,
              tenant: true,
            },
          });

          logger.info(`Created merch category: ${category.id}`, { userId: context.user.id });
          return category;
        } catch (error) {
          logger.error('Error creating merch category', error as Error);
          throw error;
        }
      }
    )
  ),

  /**
   * Update existing merchandise category
   */
  updateMerchCategory: withPermission(PERMISSIONS.UPDATE_CATEGORY)(
    authenticated(
      async (_parent: unknown, args: UpdateMerchCategoryArgs, context: GraphQLContext) => {
        try {
          const { id, input } = args;

          const category = await context.prisma.merchCategory.update({
            where: { id },
            data: input,
            include: {
              products: true,
              parent: true,
              children: true,
              tenant: true,
            },
          });

          logger.info(`Updated merch category: ${category.id}`, { userId: context.user.id });
          return category;
        } catch (error) {
          logger.error('Error updating merch category', error as Error);
          throw error;
        }
      }
    )
  ),

  /**
   * Delete merchandise category (soft delete)
   */
  deleteMerchCategory: withPermission(PERMISSIONS.DELETE_CATEGORY)(
    authenticated(async (_parent: unknown, args: { id: string }, context: GraphQLContext) => {
      try {
        const { id } = args;

        // Check if category has products
        const productsCount = await context.prisma.merchProduct.count({
          where: {
            categoryId: id,
            deletedAt: null,
          },
        });

        if (productsCount > 0) {
          throw new Error('Cannot delete category with existing products');
        }

        await context.prisma.merchCategory.update({
          where: { id },
          data: { deletedAt: new Date() },
        });

        logger.info(`Deleted merch category: ${id}`, { userId: context.user.id });
        return true;
      } catch (error) {
        logger.error('Error deleting merch category', error as Error);
        throw error;
      }
    })
  ),
};
