/**
 * Discount pricing helpers.
 *
 * A discount is "active" when `isActive` is true AND now is within
 * [startDate, endDate]. When a product has several active discounts we apply
 * "best price for the customer wins" — the single discount yielding the lowest
 * price. Discounts never stack and the discounted price is floored at 0.
 */

export type DiscountLike = {
  id: string;
  type: 'PERCENT' | 'AMOUNT';
  value: number;
  startDate: Date | string;
  endDate: Date | string;
  isActive: boolean;
};

export type DiscountResult = {
  discount: DiscountLike;
  discountedPrice: number;
  discountAmount: number;
};

const round2 = (n: number): number => Number(n.toFixed(2));

/** Discounted price for a single discount, floored at 0. */
export function applyDiscount(price: number, d: DiscountLike): number {
  const raw = d.type === 'PERCENT' ? price * (1 - d.value / 100) : price - d.value;
  return Math.max(0, round2(raw));
}

function isWithinWindow(d: DiscountLike, now: Date): boolean {
  const start = new Date(d.startDate).getTime();
  const end = new Date(d.endDate).getTime();
  return d.isActive && start <= now.getTime() && now.getTime() <= end;
}

/**
 * Pick the active discount that gives the lowest price for `price`.
 * Returns null when no discount is active.
 */
export function resolveActiveDiscount(
  price: number,
  discounts: DiscountLike[],
  now: Date
): DiscountResult | null {
  const candidates = (discounts || []).filter(d => isWithinWindow(d, now));
  if (candidates.length === 0) return null;

  let best: DiscountResult | null = null;
  for (const d of candidates) {
    const discountedPrice = applyDiscount(price, d);
    if (best === null || discountedPrice < best.discountedPrice) {
      best = {
        discount: d,
        discountedPrice,
        discountAmount: round2(price - discountedPrice),
      };
    }
  }
  return best;
}

/**
 * Attach computed discount fields to a product-like object using its own
 * `price` and `discounts`. Used by product read resolvers.
 */
export function computeProductDiscount<T extends { price: number; discounts?: DiscountLike[] }>(
  product: T,
  now: Date
): T & {
  activeDiscount: DiscountLike | null;
  discountedPrice: number | null;
  discountAmount: number | null;
} {
  const r = resolveActiveDiscount(product.price, product.discounts || [], now);
  return {
    ...product,
    activeDiscount: r?.discount ?? null,
    discountedPrice: r?.discountedPrice ?? null,
    discountAmount: r?.discountAmount ?? null,
  };
}
