import { GraphQLContext } from '@/types';
import { createLogger } from '@/utils/logger';
import { getLocalizedContent } from '@/libs/localization';
import { resolveActiveDiscount } from '@/libs/discounts';

const logger = createLogger('MERCH_QUERIES');

// Compute best-price-wins discount fields for a product from its active discounts.
const discountFields = (product: any) => {
  const d = resolveActiveDiscount(product.price, product.discounts || [], new Date());
  return {
    activeDiscount: d?.discount ?? null,
    discountedPrice: d?.discountedPrice ?? null,
    discountAmount: d?.discountAmount ?? null,
  };
};

/**
 * Merch Query Resolvers
 * Handles merchandise products and categories queries with multi-language support
 */
export const merchQueries = {
  /**
   * Get merchandise products with filtering and pagination
   */
  getMerchProducts: async (_parent: any, args: any, context: GraphQLContext) => {
    try {
      const {
        language = 'en',
        status,
        categoryId,
        isFeatured,
        tenantId,
        tenantSlug,
        limit = 50,
        offset = 0,
      } = args;

      // Build where clause
      const where: any = { deletedAt: null };

      if (status) where.status = status;
      if (categoryId) where.categoryId = categoryId;
      if (isFeatured !== undefined) where.isFeatured = isFeatured;

      // Handle tenant filtering
      if (tenantId) {
        where.tenantId = tenantId;
      } else if (tenantSlug) {
        // If tenantSlug is provided, find the tenant first
        const tenant = await context.prisma.tenant.findUnique({
          where: { slug: tenantSlug },
        });
        if (tenant) {
          where.tenantId = tenant.id;
        } else {
          // If tenant not found, return empty array
          return [];
        }
      }

      const products = await context.prisma.merchProduct.findMany({
        where,
        include: {
          category: true,
          tenant: true,
          productVariants: {
            where: { deletedAt: null },
            orderBy: { position: 'asc' },
          },
          discounts: { where: { deletedAt: null, isActive: true } },
        },
        take: limit,
        skip: offset,
        orderBy: [{ isFeatured: 'desc' }, { status: 'asc' }, { createdAt: 'desc' }],
      });

      // Transform for localization
      return products.map(product => ({
        ...product,
        name: getLocalizedContent(product.name, language),
        description: product.description
          ? getLocalizedContent(product.description, language)
          : null,
        shortDescription: product.shortDescription
          ? getLocalizedContent(product.shortDescription, language)
          : null,
        metaTitle: product.metaTitle ? getLocalizedContent(product.metaTitle, language) : null,
        metaDescription: product.metaDescription
          ? getLocalizedContent(product.metaDescription, language)
          : null,
        searchKeywords: product.searchKeywords
          ? getLocalizedContent(product.searchKeywords, language)
          : null,
        category: product.category
          ? {
              ...product.category,
              name: getLocalizedContent(product.category.name, language),
              description: product.category.description
                ? getLocalizedContent(product.category.description, language)
                : null,
            }
          : null,
        variants: product.productVariants.map((variant: any) => ({
          ...variant,
          title: variant.title ? getLocalizedContent(variant.title, language) : null,
          // Keep optionValues as-is (contains multi-language data)
        })),
        ...discountFields(product),
      }));
    } catch (error) {
      logger.error('Error fetching merch products', error as Error);
      throw new Error('Failed to fetch merch products');
    }
  },

  /**
   * Get single merchandise product by ID
   */
  getMerchProductById: async (_parent: any, args: any, context: GraphQLContext) => {
    try {
      const { id, language = 'en' } = args;

      const product = await context.prisma.merchProduct.findUnique({
        where: { id },
        include: {
          category: true,
          tenant: true,
          productVariants: {
            where: { deletedAt: null },
            orderBy: { position: 'asc' },
          },
          discounts: { where: { deletedAt: null, isActive: true } },
        },
      });

      if (!product || product.deletedAt) return null;

      // Transform for localization
      return {
        ...product,
        name: getLocalizedContent(product.name, language),
        description: product.description
          ? getLocalizedContent(product.description, language)
          : null,
        shortDescription: product.shortDescription
          ? getLocalizedContent(product.shortDescription, language)
          : null,
        metaTitle: product.metaTitle ? getLocalizedContent(product.metaTitle, language) : null,
        metaDescription: product.metaDescription
          ? getLocalizedContent(product.metaDescription, language)
          : null,
        searchKeywords: product.searchKeywords
          ? getLocalizedContent(product.searchKeywords, language)
          : null,
        category: product.category
          ? {
              ...product.category,
              name: getLocalizedContent(product.category.name, language),
              description: product.category.description
                ? getLocalizedContent(product.category.description, language)
                : null,
            }
          : null,
        variants: product.productVariants.map((variant: any) => ({
          ...variant,
          title: variant.title ? getLocalizedContent(variant.title, language) : null,
          // Keep optionValues as-is (contains multi-language data)
        })),
        ...discountFields(product),
      };
    } catch (error) {
      logger.error('Error fetching merch product', error as Error);
      throw new Error('Failed to fetch merch product');
    }
  },

  /**
   * Get merchandise categories
   */
  getMerchCategories: async (_parent: any, args: any, context: GraphQLContext) => {
    try {
      const { language = 'en' } = args;

      const categories = await context.prisma.merchCategory.findMany({
        where: { deletedAt: null },
        include: {
          products: true,
          parent: true,
          children: true,
          tenant: true,
        },
        orderBy: { name: 'asc' },
      });

      // Transform for localization
      return categories.map(category => ({
        ...category,
        name: getLocalizedContent(category.name, language),
        description: category.description
          ? getLocalizedContent(category.description, language)
          : null,
        parent: category.parent
          ? {
              ...category.parent,
              name: getLocalizedContent(category.parent.name, language),
              description: category.parent.description
                ? getLocalizedContent(category.parent.description, language)
                : null,
            }
          : null,
        children: category.children.map(child => ({
          ...child,
          name: getLocalizedContent(child.name, language),
          description: child.description ? getLocalizedContent(child.description, language) : null,
        })),
      }));
    } catch (error) {
      logger.error('Error fetching merch categories', error as Error);
      throw new Error('Failed to fetch merch categories');
    }
  },

  /**
   * Get single merchandise category by ID
   */
  getMerchCategoryById: async (_parent: any, args: any, context: GraphQLContext) => {
    try {
      const { id, language = 'en' } = args;

      const category = await context.prisma.merchCategory.findUnique({
        where: { id },
        include: {
          products: true,
          parent: true,
          children: true,
          tenant: true,
        },
      });

      if (!category || category.deletedAt) return null;

      // Transform for localization
      return {
        ...category,
        name: getLocalizedContent(category.name, language),
        description: category.description
          ? getLocalizedContent(category.description, language)
          : null,
        parent: category.parent
          ? {
              ...category.parent,
              name: getLocalizedContent(category.parent.name, language),
              description: category.parent.description
                ? getLocalizedContent(category.parent.description, language)
                : null,
            }
          : null,
        children: category.children.map(child => ({
          ...child,
          name: getLocalizedContent(child.name, language),
          description: child.description ? getLocalizedContent(child.description, language) : null,
        })),
      };
    } catch (error) {
      logger.error('Error fetching merch category', error as Error);
      throw new Error('Failed to fetch merch category');
    }
  },
};
