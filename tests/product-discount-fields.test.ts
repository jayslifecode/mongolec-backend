import { computeProductDiscount } from '../src/libs/discounts';

it('computeProductDiscount attaches discounted fields when a discount is active', () => {
  const now = new Date('2026-06-01');
  const product = {
    price: 100,
    discounts: [
      {
        id: 'd',
        type: 'PERCENT' as const,
        value: 20,
        isActive: true,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    ],
  };
  const out = computeProductDiscount(product, now);
  expect(out.discountedPrice).toBe(80);
  expect(out.discountAmount).toBe(20);
  expect(out.activeDiscount?.id).toBe('d');
});

it('computeProductDiscount returns null fields when none active', () => {
  const out = computeProductDiscount({ price: 100, discounts: [] }, new Date());
  expect(out.discountedPrice).toBeNull();
  expect(out.activeDiscount).toBeNull();
});
