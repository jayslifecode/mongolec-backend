/**
 * Rally for Rangers — shared text/name utilities.
 *
 * Pure functions only (no IO) so they can be unit-tested directly.
 */

/** Lowercase, strip diacritics, collapse non-alphanumerics into single hyphens. */
export function kebab(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalise a human name for fuzzy matching across sources (filenames, spreadsheet rows,
 * manifest keys): lowercase, strip diacritics/quotes, underscores and punctuation -> single
 * spaces, collapse whitespace.
 */
export function normaliseName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['"‘’“”]/g, '')
    .replace(/[_.]+/g, ' ')
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "First_Last" or "First Last" -> normalised "first last" key used for portrait matching. */
export function nameKeyFromFileStem(stem: string): string {
  return normaliseName(stem.replace(/_/g, ' '));
}

/** Split a "First Last [Extra...]" full name into first/last (last = remaining words joined). */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/** Candidate normalised-name keys to try when matching a rider/ranger/team name to a portrait. */
export function nameMatchCandidates(fullName: string): string[] {
  const cleaned = normaliseName(fullName.replace(/\s*-\s*\d{4}.*$/, '').replace(/\([^)]*\)/g, ''));
  const candidates = new Set<string>([cleaned]);
  const { first, last } = splitName(cleaned);
  if (first && last) {
    candidates.add(`${first} ${last}`);
    candidates.add(`${first}`);
  }
  // Nickname in quotes/parens already stripped above; also try just first token + last token
  // when there are middle names/initials.
  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length > 2) {
    candidates.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  }
  return Array.from(candidates).filter(Boolean);
}

/** True if the given URL points at the old WordPress media host. */
export function isWordpressUrl(url: string | null | undefined): boolean {
  return !!url && /rallyforrangers\.org\/wp-content\//i.test(url);
}
