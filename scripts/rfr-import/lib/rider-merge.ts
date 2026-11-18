/**
 * Rally for Rangers — rider name normalisation + merging.
 *
 * The "Riders by Rally" sheet lists the same person once per rally they attended, suffixed
 * with the year ("Wesley Thornberry - 2022"). Portrait folders add further sightings with no
 * suffix at all. This module is pure (no IO) so it can be unit-tested directly: it normalises
 * a raw name, derives a case-folded merge key, and folds every sighting of the same person
 * into one record (longest bio wins; its casing becomes the display name).
 */

/** "(Kathleen)" style nickname groups. */
const PARENTHETICAL = /\([^)]*\)/g;
/** A trailing year (with or without a leading dash) and anything after it: "Name - 2022 Bhutan", "Name 2024". */
const TRAILING_YEAR = /\s*(?:-\s*)?\b(?:19|20)\d{2}\b.*$/;

/** Drop nickname parentheticals and a trailing year suffix, then collapse whitespace. */
export function normaliseRiderName(raw: string): string {
  return raw
    .replace(PARENTHETICAL, ' ')
    .replace(TRAILING_YEAR, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Key used to merge sightings of the same person across sources: accents, case, punctuation
 * and spacing are all folded away, so "André", "T.J." and "D'Avanzo" match "Andre", "TJ"
 * and "D Avanzo".
 */
export function riderMergeKey(raw: string): string {
  return normaliseRiderName(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Surname particles that belong to the last name ("De Groot", "San Filippo", "de With"). */
const SURNAME_PARTICLES = new Set(['de', 'van', 'von', 'der', 'den', 'san', 'del', 'della', 'da', 'di', 'du', 'le', 'la']);

/**
 * Split a display name into first/last for sorting by last name: the last word is the
 * surname, together with any particles right before it; everything before is the first name
 * (middle names and initials included).
 */
export function splitRiderName(full: string): { firstName: string; lastName: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { firstName: words[0] ?? '', lastName: '' };
  let start = words.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(words[start - 1].toLowerCase())) start -= 1;
  return { firstName: words.slice(0, start).join(' '), lastName: words.slice(start).join(' ') };
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
  /** Explicit name parts (master sheet); otherwise derived with `splitRiderName`. */
  firstName?: string;
  lastName?: string;
  bio: string;
  country: string;
  photo: string | null;
  /** slug -> link info; a Map so repeated sightings of the same rally collapse to one link. */
  rallies: Map<string, { year: number | null; role: string | null }>;
}

/** Fold every sighting into one record per person, keyed by `riderMergeKey`. */
type RallyLinks = MergedRider['rallies'];

/** A rally link is added, or upgraded when the earlier sighting had no year. */
function withRally(rallies: RallyLinks, sighting: RiderSighting): RallyLinks {
  if (!sighting.rallySlug) return rallies;
  const existing = rallies.get(sighting.rallySlug);
  if (existing && !(existing.year === null && sighting.year != null)) return rallies;
  return new Map(rallies).set(sighting.rallySlug, {
    year: sighting.year ?? null,
    role: sighting.role ?? 'Rider',
  });
}

/** Undated portraits rank below any dated one. */
const UNDATED_PHOTO = Number.NEGATIVE_INFINITY;

function photoYearOf(sighting: RiderSighting): number {
  return sighting.year ?? UNDATED_PHOTO;
}

/**
 * Fold one more sighting into a rider: longest bio wins (with its name casing). The featured
 * photo is the portrait from the rider's latest rally (client rule, round 4): a sighting's photo
 * replaces the current one only when it is from a strictly later year (`takePhoto`).
 */
function foldSighting(
  merged: MergedRider,
  sighting: RiderSighting,
  displayName: string,
  bio: string,
  takePhoto: boolean
): MergedRider {
  const longerBio = bio.length > merged.bio.length;
  return {
    ...merged,
    bio: longerBio ? bio : merged.bio,
    displayName: longerBio ? displayName : merged.displayName,
    photo: takePhoto ? (sighting.photo ?? null) : merged.photo,
    rallies: withRally(merged.rallies, sighting),
  };
}

export function mergeRiderSightings(
  sightings: RiderSighting[],
  defaultCountry: string
): MergedRider[] {
  const byKey = new Map<string, MergedRider>();
  /** Year of the portrait currently featured per rider (internal; not part of the output). */
  const photoYearByKey = new Map<string, number>();

  for (const sighting of sightings) {
    const displayName = normaliseRiderName(sighting.rawName);
    if (!displayName) continue;
    const key = riderMergeKey(displayName);
    const bio = (sighting.bio ?? '').trim();
    const current = byKey.get(key);
    const currentPhotoYear = photoYearByKey.get(key);
    const takePhoto =
      Boolean(sighting.photo) &&
      (currentPhotoYear === undefined || photoYearOf(sighting) > currentPhotoYear);
    if (takePhoto) photoYearByKey.set(key, photoYearOf(sighting));
    const next = current
      ? foldSighting(current, sighting, displayName, bio, takePhoto)
      : {
          key,
          displayName,
          bio,
          country: sighting.country || defaultCountry,
          photo: sighting.photo ?? null,
          rallies: withRally(new Map(), sighting),
        };
    byKey.set(key, next);
  }

  return Array.from(byKey.values());
}
