/**
 * Rally for Rangers — rider name normalisation + merging.
 *
 * The "Riders by Rally" sheet lists the same person once per rally they attended, suffixed
 * with the year ("Wesley Thornberry - 2022"). Portrait folders add further sightings with no
 * suffix at all. This module is pure (no IO) so it can be unit-tested directly: it normalises
 * a raw name, derives a case-folded merge key, and folds every sighting of the same person
 * into one record (longest bio wins; its casing becomes the display name).
 */

/** Strip a trailing " - YYYY" (and anything after it) and collapse whitespace. */
export function normaliseRiderName(raw: string): string {
  return raw
    .replace(/\s*-\s*\d{4}\b.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Case-folded key used to merge sightings of the same person across sources. */
export function riderMergeKey(raw: string): string {
  return normaliseRiderName(raw).toLowerCase();
}

export interface RiderSighting {
  /** Raw name exactly as it appeared in the source (sheet row or portrait filename). */
  rawName: string;
  bio?: string;
  photo?: string | null;
  country?: string;
  /** Rally this sighting links the rider to, if any (sheet group or portrait folder). */
  rallySlug?: string | null;
  year?: number | null;
  role?: string | null;
}

export interface MergedRider {
  key: string;
  displayName: string;
  bio: string;
  country: string;
  photo: string | null;
  /** slug -> link info; a Map so repeated sightings of the same rally collapse to one link. */
  rallies: Map<string, { year: number | null; role: string | null }>;
}

/** Fold every sighting into one record per person, keyed by `riderMergeKey`. */
export function mergeRiderSightings(
  sightings: RiderSighting[],
  defaultCountry: string
): MergedRider[] {
  const byKey = new Map<string, MergedRider>();

  for (const sighting of sightings) {
    const displayName = normaliseRiderName(sighting.rawName);
    if (!displayName) continue;
    const key = displayName.toLowerCase();
    const bio = (sighting.bio ?? '').trim();

    let merged = byKey.get(key);
    if (!merged) {
      merged = {
        key,
        displayName,
        bio,
        country: sighting.country || defaultCountry,
        photo: sighting.photo ?? null,
        rallies: new Map(),
      };
      byKey.set(key, merged);
    } else {
      // Longest bio wins; its name casing becomes the display name.
      if (bio.length > merged.bio.length) {
        merged.bio = bio;
        merged.displayName = displayName;
      }
      if (!merged.photo && sighting.photo) merged.photo = sighting.photo;
    }

    if (sighting.rallySlug) {
      const existing = merged.rallies.get(sighting.rallySlug);
      if (!existing || (existing.year === null && sighting.year !== null)) {
        merged.rallies.set(sighting.rallySlug, {
          year: sighting.year ?? null,
          role: sighting.role ?? 'Rider',
        });
      }
    }
  }

  return Array.from(byKey.values());
}
