/**
 * Rally for Rangers — rider tier thresholds.
 *
 * Tier is computed from `rallyCount` (how many distinct rallies a Participant has ridden),
 * never stored. Keep the thresholds in this single constant so the GraphQL resolver and any
 * tests agree on one source of truth.
 *
 * 1 rally -> RIDER, 2-3 -> RETURNING, 4-6 -> VETERAN, 7+ -> LEGEND.
 */
export type RiderTier = 'RIDER' | 'RETURNING' | 'VETERAN' | 'LEGEND';

export const RIDER_TIER_THRESHOLDS: Record<Exclude<RiderTier, 'RIDER'>, number> = {
  RETURNING: 2,
  VETERAN: 4,
  LEGEND: 7,
};

export const RIDER_TIER_LABELS: Record<RiderTier, string> = {
  RIDER: 'Rider',
  RETURNING: 'Returning Rider',
  VETERAN: 'Veteran',
  LEGEND: 'Legend',
};

/** Pure: rally count -> tier. Count <= 0 still resolves to RIDER (never throws). */
export function tierFor(rallyCount: number): RiderTier {
  if (rallyCount >= RIDER_TIER_THRESHOLDS.LEGEND) return 'LEGEND';
  if (rallyCount >= RIDER_TIER_THRESHOLDS.VETERAN) return 'VETERAN';
  if (rallyCount >= RIDER_TIER_THRESHOLDS.RETURNING) return 'RETURNING';
  return 'RIDER';
}
