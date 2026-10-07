/**
 * Rally for Rangers — "Riders by Rally" group-header lookups.
 *
 * The sheet groups rows under headers like
 * "2023  —  National Parks of Southern Mongolia  (12 riders)". This reads just the header
 * rows to answer "how many riders went on rally X" for story stats — never invented numbers.
 */
import * as fs from 'fs';

type SheetRow = { '#': string; Name: string; Type: string };

export interface RiderGroup {
  year: number;
  label: string;
  riderCount: number;
}

function parseHeader(s: string): RiderGroup | null {
  const m = s.match(/^\s*(\d{4})\s*[—-]+\s*(.+?)\s*\((\d+)\s*riders?\)/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), label: m[2].trim(), riderCount: parseInt(m[3], 10) };
}

export function loadRiderGroups(sheetFile: string): RiderGroup[] {
  const sheets = JSON.parse(fs.readFileSync(sheetFile, 'utf-8'));
  const rows: SheetRow[] = sheets['Riders by Rally'];
  const groups: RiderGroup[] = [];
  for (const r of rows) {
    if (r['#'] && !r.Name && !r.Type) {
      const g = parseHeader(r['#']);
      if (g) groups.push(g);
    }
  }
  return groups;
}

/** Total riders for a given year whose group label mentions `countryOrPark` (case-insensitive). */
export function riderCountFor(
  groups: RiderGroup[],
  year: number,
  countryOrPark: string
): number | null {
  const matches = groups.filter(
    g => g.year === year && g.label.toLowerCase().includes(countryOrPark.toLowerCase())
  );
  if (matches.length === 0) return null;
  return matches.reduce((sum, g) => sum + g.riderCount, 0);
}
