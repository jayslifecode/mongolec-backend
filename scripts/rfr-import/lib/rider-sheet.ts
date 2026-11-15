/**
 * Rally for Rangers — master rider spreadsheet (RFR_Riders_Master.xlsx) row mapping.
 *
 * One row per rider, one column per rally; an "x" in a rally column means the rider attended.
 * The client edits this sheet and the importer (`import-people.ts --from-sheet`) treats it as
 * the source of truth for who rode which rally. "Rallies (count)" and "Countries" are derived
 * for readability and ignored on import. Pure, no IO — the CLI wraps it with exceljs.
 */

import { riderMergeKey, type MergedRider } from './rider-merge';

export interface ExistingRider {
  firstName: string;
  lastName: string;
  bio: string | null;
  photo: string | null;
  country: string;
}

const yearOfSlug = (slug: string): number | null => {
  const m = slug.match(/-(\d{4})$/);
  return m ? parseInt(m[1], 10) : null;
};

const richness = (e: ExistingRider): number => (e.bio?.trim() ? 2 : 0) + (e.photo ? 1 : 0);

/**
 * Existing rows by merge key. Duplicates (e.g. "Graham Cashwell" and "Graham Cashwell 2024"
 * before the dedupe import has run) resolve to the row carrying the most data (bio, then photo).
 */
function indexExistingByKey(existing: ExistingRider[]): Map<string, ExistingRider> {
  return existing.reduce((byKey, row) => {
    const key = riderMergeKey(`${row.firstName} ${row.lastName}`);
    const current = byKey.get(key);
    if (!current || richness(row) > richness(current)) byKey.set(key, row);
    return byKey;
  }, new Map<string, ExistingRider>());
}

/**
 * Sheet riders -> MergedRider[]: the sheet decides who exists and which rallies they rode;
 * bio, photo and country are carried over from the existing DB row with the same merge key.
 */
export function mergeSheetRiders(
  sheetRiders: SheetRider[],
  existing: ExistingRider[],
  defaultCountry: string
): MergedRider[] {
  const existingByKey = indexExistingByKey(existing);
  const seen = new Map<string, string>();
  return sheetRiders.map(rider => {
    const displayName = `${rider.firstName} ${rider.lastName}`.trim();
    const key = riderMergeKey(displayName);
    const earlier = seen.get(key);
    if (earlier) {
      throw new Error(`Rider listed twice in the sheet: "${earlier}" and "${displayName}" — merge the rows`);
    }
    seen.set(key, displayName);
    const match = existingByKey.get(key);
    return {
      key,
      displayName,
      firstName: rider.firstName,
      lastName: rider.lastName,
      bio: match?.bio ?? '',
      photo: match?.photo ?? null,
      country: match?.country || defaultCountry,
      rallies: new Map(
        rider.rallySlugs.map(slug => [slug, { year: yearOfSlug(slug), role: 'Rider' }])
      ),
    };
  });
}

export interface SheetRider {
  firstName: string;
  lastName: string;
  /** Rally slugs in sheet column order. */
  rallySlugs: string[];
}

export interface SheetRally {
  slug: string;
  title: string;
}

export const SHEET_FIXED_HEADERS = ['Last name', 'First name', 'Rallies (count)', 'Countries'] as const;
const FIRST_RALLY_COLUMN = SHEET_FIXED_HEADERS.length;
const ATTENDED_MARK = 'x';

/** "mongolia-2014" -> "Mongolia", "usa-2025" -> "USA". */
export function countryFromRallySlug(slug: string): string {
  const prefix = slug.replace(/-\d{4}$/, '');
  if (prefix === 'usa') return 'USA';
  return prefix
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function uniqueCountries(slugs: string[]): string {
  return Array.from(new Set(slugs.map(countryFromRallySlug))).join(', ');
}

/** Two rallies with one title would give two indistinguishable columns. */
function assertUniqueTitles(rallies: SheetRally[]): void {
  const slugByTitle = new Map<string, string>();
  for (const rally of rallies) {
    const earlier = slugByTitle.get(rally.title);
    if (earlier) {
      throw new Error(`Two rallies have the same title "${rally.title}": ${earlier} and ${rally.slug} — rename one`);
    }
    slugByTitle.set(rally.title, rally.slug);
  }
}

/** Header row + one row per rider, cells as strings. */
export function toSheetRows(riders: SheetRider[], rallies: SheetRally[]): string[][] {
  assertUniqueTitles(rallies);
  const header = [...SHEET_FIXED_HEADERS, ...rallies.map(r => r.title)];
  const rows = riders.map(rider => {
    const attended = new Set(rider.rallySlugs);
    const orderedSlugs = rallies.filter(r => attended.has(r.slug)).map(r => r.slug);
    return [
      rider.lastName,
      rider.firstName,
      String(orderedSlugs.length),
      uniqueCountries(orderedSlugs),
      ...rallies.map(r => (attended.has(r.slug) ? ATTENDED_MARK : '')),
    ];
  });
  return [header, ...rows];
}

const cell = (row: string[], index: number): string => (row[index] ?? '').trim();

/**
 * Parse sheet rows back into riders. `rallyKey` maps a rally column title to its slug.
 * Throws (naming the 1-based sheet row) when the four fixed columns moved, on an unknown rally
 * column, on marks under an unnamed column, or on a marked row with no name.
 */
export function fromSheetRows(rows: string[][], rallyKey: Map<string, string>): SheetRider[] {
  const [header = [], ...body] = rows;
  SHEET_FIXED_HEADERS.forEach((expected, index) => {
    if (cell(header, index) !== expected) {
      throw new Error(
        `row 1: column ${index + 1} must be "${expected}" (found "${cell(header, index)}") — don't move the first four columns`
      );
    }
  });
  const rallyColumns = header.slice(FIRST_RALLY_COLUMN).flatMap((rawTitle, offset) => {
    const index = FIRST_RALLY_COLUMN + offset;
    const title = rawTitle.trim();
    if (!title) {
      // Spreadsheet apps often carry empty trailing columns; harmless unless someone marked them.
      if (body.some(row => cell(row, index))) {
        throw new Error(`row 1: column ${index + 1} has no rally name but has marks in it`);
      }
      return [];
    }
    const slug = rallyKey.get(title);
    if (!slug) {
      throw new Error(
        `row 1: rally column "${title}" is not in the Rally key sheet — add the rally first`
      );
    }
    return [{ index, slug }];
  });

  return body.flatMap((row, i) => {
    const sheetRow = i + 2;
    const lastName = cell(row, 0);
    const firstName = cell(row, 1);
    const rallySlugs = rallyColumns
      .filter(col => cell(row, col.index).toLowerCase() === ATTENDED_MARK)
      .map(col => col.slug);

    if (!firstName && !lastName) {
      if (rallySlugs.length) throw new Error(`row ${sheetRow}: rally marked but rider name is empty`);
      return [];
    }
    return [{ firstName, lastName, rallySlugs }];
  });
}
