/**
 * Rally for Rangers — "Riders by Rally" sheet group headers.
 *
 * Headers look like "2014  —  Lake Hovsgol National Park - Mongolia  (12 riders)", but several
 * omit the " - Country" suffix ("2024  —  National Parks of Bhutan  (14 riders)",
 * "2023  —  Namibian Rangers  (14 riders)"). Those used to parse to null, which silently
 * dropped the rally link for every rider listed under them. Pure, no IO.
 */
import { kebab } from './text';

export interface GroupHeader {
  year: number;
  /** Everything between the dash and the "(N riders)" count. */
  label: string;
  /** Park / area name: the label without its " - Country" suffix. */
  park: string;
  /** Canonical country name, or null when the header names none ("No Rally Assigned"). */
  country: string | null;
  /** `${kebab(country)}-${year}`, or null when the group is not tied to a rally. */
  rallySlug: string | null;
}

const HEADER = /^\s*(\d{4})\s*[—–-]+\s*(.+?)\s*(?:\([^)]*\))?\s*$/;
const COUNTRY_SUFFIX = /^(.+?)\s+-\s+([^-]+)$/;

/** Country words that can appear inside a label with no suffix → canonical country name. */
const KNOWN_COUNTRIES: ReadonlyArray<[RegExp, string]> = [
  [/\bmongolia\b/i, 'Mongolia'],
  [/\bbhutan\b/i, 'Bhutan'],
  [/\bperu\b/i, 'Peru'],
  [/\bnepal\b/i, 'Nepal'],
  [/\bargentina\b/i, 'Argentina'],
  [/\blaos\b/i, 'Laos'],
  [/\bnamibian?\b/i, 'Namibia'],
  [/\b(?:usa|u\.s\.a\.?)\b/i, 'USA'],
];

function countryFromWords(label: string): string | null {
  const hit = KNOWN_COUNTRIES.find(([pattern]) => pattern.test(label));
  return hit ? hit[1] : null;
}

/** Parse a group header row; null when the line is not a dated group header. */
export function parseGroupHeader(header: string): GroupHeader | null {
  const m = header.match(HEADER);
  if (!m) return null;

  const year = parseInt(m[1], 10);
  const label = m[2].trim();
  const suffix = label.match(COUNTRY_SUFFIX);
  const park = suffix ? suffix[1].trim() : label;
  const country = suffix ? countryFromWords(suffix[2]) ?? suffix[2].trim() : countryFromWords(label);

  return {
    year,
    label,
    park,
    country,
    rallySlug: country ? `${kebab(country)}-${year}` : null,
  };
}
