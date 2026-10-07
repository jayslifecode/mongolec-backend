import { tierFor } from '../src/config/rider-tiers';

describe('tierFor', () => {
  it('returns RIDER for a single rally', () => {
    expect(tierFor(1)).toBe('RIDER');
  });

  it('returns RIDER for 0 (never throws on an empty count)', () => {
    expect(tierFor(0)).toBe('RIDER');
  });

  it('returns RETURNING at the lower boundary (2)', () => {
    expect(tierFor(2)).toBe('RETURNING');
  });

  it('returns RETURNING at the upper boundary (3)', () => {
    expect(tierFor(3)).toBe('RETURNING');
  });

  it('returns VETERAN at the lower boundary (4)', () => {
    expect(tierFor(4)).toBe('VETERAN');
  });

  it('returns VETERAN at the upper boundary (6)', () => {
    expect(tierFor(6)).toBe('VETERAN');
  });

  it('returns LEGEND at the lower boundary (7)', () => {
    expect(tierFor(7)).toBe('LEGEND');
  });

  it('returns LEGEND for large counts', () => {
    expect(tierFor(12)).toBe('LEGEND');
  });
});
