/**
 * Rally for Rangers — Rider_Portraits Drive folder scanning.
 *
 * The uploader (`upload-images.ts`) already deduplicated portrait images by person name when
 * it populated `rfr/riders/*.webp`, so the image manifest alone can no longer tell us which
 * rally folder a rider's portrait came from. This re-derives rally membership by walking the
 * Drive export folders directly: `Rider_Portraits/<Year>_<Country>[_<Park>]/<First_Last>.<ext>`.
 * `Rider_Portraits/New Folder` holds portraits/people with no rally link at all.
 */
import * as fs from 'fs';
import * as path from 'path';
import { nameKeyFromFileStem } from './text';
import { riderMergeKey } from './rider-merge';

const IMAGE_EXT = /\.(jpe?g|png|webp|heic)$/i;

/** "2021_Mongolia_Dariganga" -> { year: 2021, country: "Mongolia", rallySlug: "mongolia-2021" }. */
export function parsePortraitFolderName(
  folderName: string
): { year: number; country: string; rallySlug: string } | null {
  if (folderName === 'New Folder') return null;
  const m = folderName.match(/^(\d{4})_([A-Za-z-]+)/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const country = m[2].replace(/-/g, ' ');
  const rallySlug = `${country.toLowerCase().replace(/\s+/g, '-')}-${year}`;
  return { year, country, rallySlug };
}

/** "First_Last.jpg" -> "First Last" (display form; use `nameKeyFromFileStem` to match it). */
export function nameFromFilename(filename: string): string {
  const stem = filename.replace(IMAGE_EXT, '');
  return stem.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface PortraitSighting {
  name: string;
  folder: string;
  rallySlug: string | null;
  year: number | null;
  country: string | null;
}

/** Camera-generated filenames ("FRF01826", "IMG_1234", "DSC0001") name no person. */
const CAMERA_STEM = /^[A-Z]{2,4}_?\d{3,}$/i;

/** False for unnamed camera files, which must never become a rider. */
export function isPersonFileStem(stem: string): boolean {
  return !CAMERA_STEM.test(stem.trim());
}

export interface ScanOptions {
  /** `riderMergeKey`s of people who must not be read as riders (rangers). */
  excludeKeys?: ReadonlySet<string>;
}

/**
 * Walks every `<Year>_<Country>[...]` folder (and `New Folder`) under `baseDir`, skipping
 * camera-named files and anyone whose merge key is in `excludeKeys`.
 */
export function scanPortraitFolders(baseDir: string, opts: ScanOptions = {}): PortraitSighting[] {
  if (!fs.existsSync(baseDir)) return [];
  const excludeKeys = opts.excludeKeys ?? new Set<string>();
  const sightings: PortraitSighting[] = [];

  for (const folder of fs.readdirSync(baseDir)) {
    const folderPath = path.join(baseDir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    const parsed = parsePortraitFolderName(folder);

    for (const file of fs.readdirSync(folderPath)) {
      if (!IMAGE_EXT.test(file)) continue;
      if (!isPersonFileStem(file.replace(IMAGE_EXT, ''))) continue;
      const name = nameFromFilename(file);
      if (excludeKeys.has(riderMergeKey(name))) continue;
      sightings.push({
        name,
        folder,
        rallySlug: parsed?.rallySlug ?? null,
        year: parsed?.year ?? null,
        country: parsed?.country ?? null,
      });
    }
  }
  return sightings;
}

/** Re-exported for callers that need the same normalised key the photo matcher uses. */
export { nameKeyFromFileStem };
