import { ValidationError } from '@/utils/errors';
import type { MerchProductVariantInput } from '@/graphql/types/args';

export type VariantInput = MerchProductVariantInput;

interface StoredVariant {
  id: string;
  sku: string;
  deletedAt: Date | null;
}

/** The subset of the Prisma client (or transaction) this helper needs. */
export interface VariantStore {
  merchVariant: {
    findMany: (args: { where: { productId: string } }) => Promise<StoredVariant[]>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
}

const toWriteData = (variant: VariantInput, index: number): Record<string, unknown> => ({
  ...variant,
  position: variant.position ?? index,
  inventory: variant.inventory ?? 0,
  isAvailable: variant.isAvailable ?? true,
});

const findDuplicateSku = (variants: VariantInput[]): string | undefined => {
  const seen = new Set<string>();
  return variants.map(v => v.sku).find(sku => (seen.has(sku) ? true : (seen.add(sku), false)));
};

/**
 * Reconcile a product's variants with the list the client sent, keyed by SKU.
 *
 * - same SKU already stored (live or soft-deleted) → update in place and un-delete it,
 *   so the variant keeps its id (order items reference it) and the unique (sku, productId)
 *   constraint is never hit;
 * - new SKU → create;
 * - live variant whose SKU is no longer sent → soft delete.
 *
 * Earlier code deleted everything and re-created it, which the soft-delete middleware
 * turns into "mark deleted then insert the same SKU again" — a unique-constraint error.
 */
export async function syncProductVariants(
  store: VariantStore,
  productId: string,
  variants: VariantInput[]
): Promise<void> {
  const duplicate = findDuplicateSku(variants);
  if (duplicate) {
    throw new ValidationError(`Duplicate variant SKU "${duplicate}" in request`);
  }

  const existing = await store.merchVariant.findMany({ where: { productId } });
  const existingBySku = new Map(existing.map(row => [row.sku, row]));
  const sentSkus = new Set(variants.map(v => v.sku));

  for (const [index, variant] of variants.entries()) {
    const data = toWriteData(variant, index);
    const current = existingBySku.get(variant.sku);
    if (current) {
      await store.merchVariant.update({ where: { id: current.id }, data: { ...data, deletedAt: null } });
    } else {
      await store.merchVariant.create({ data: { ...data, productId } });
    }
  }

  const removed = existing.filter(row => row.deletedAt === null && !sentSkus.has(row.sku));
  for (const row of removed) {
    await store.merchVariant.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  }
}
