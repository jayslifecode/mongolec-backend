import { applyDiscount, resolveActiveDiscount } from '../src/libs/discounts';

const d = (o: Partial<any> = {}) => ({
  id: 'd',
  type: 'PERCENT',
  value: 10,
  isActive: true,
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  ...o,
});
const NOW = new Date('2026-06-01');

describe('applyDiscount', () => {
  it('percent reduces proportionally', () => {
    expect(applyDiscount(100, d({ type: 'PERCENT', value: 25 }))).toBe(75);
  });
  it('amount subtracts and floors at 0', () => {
    expect(applyDiscount(30, d({ type: 'AMOUNT', value: 50 }))).toBe(0);
  });
});

describe('resolveActiveDiscount', () => {
  it('returns null when no discounts', () => {
    expect(resolveActiveDiscount(100, [], NOW)).toBeNull();
  });
  it('ignores inactive or out-of-window discounts', () => {
    const inactive = d({ isActive: false });
    const past = d({ endDate: new Date('2026-02-01') });
    expect(resolveActiveDiscount(100, [inactive, past], NOW)).toBeNull();
  });
  it('best-price-wins picks the largest reduction', () => {
    const r = resolveActiveDiscount(
      100,
      [d({ id: 'a', type: 'PERCENT', value: 10 }), d({ id: 'b', type: 'AMOUNT', value: 30 })],
      NOW
    );
    expect(r?.discount.id).toBe('b');
    expect(r?.discountedPrice).toBe(70);
    expect(r?.discountAmount).toBe(30);
  });
});
