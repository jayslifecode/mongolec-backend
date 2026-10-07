/**
 * Rally for Rangers — asset discovery.
 *
 * Walks the Drive export (`~/Downloads/Website 2`) and derives the full upload plan: every
 * local image file paired with its destination B2 key and target resize dimension. The
 * directory-walking is IO; the key/slug derivation below it is pure and exported separately
 * so it can be unit-tested without touching the filesystem.
 */
import * as fs from 'fs';
import * as path from 'path';
import { kebab, nameKeyFromFileStem } from './text';

export const ASSETS_ROOT = path.join(process.env.HOME || '', 'Downloads', 'Website 2');

export const RALLY_LONG_EDGE = 2000;
export const SITE_LONG_EDGE = 2000;
export const PORTRAIT_LONG_EDGE = 900;

const IMAGE_EXT = /\.(jpe?g|png|heic)$/i; // webp sources: convert to png first (sips cannot read them)

export interface UploadItem {
  /** B2 object key, e.g. `rfr/rallies/mongolia-2024/1.webp`. */
  key: string;
  /** Absolute local source path. */
  source: string;
  /** Resize target (longest edge, px). */
  maxDim: number;
}

/**
 * Maps a `RfR Rally Page photos/<folder>` directory name to the DB rally slug it belongs to.
 * Exceptions per the 2026-10-06 launch plan:
 *  - `Peru_2025` -> `peru-2026` (spreadsheet names the rally "Peru 2026"; it runs May 2026).
 *  - `Mongolia_2026` -> `mongolia-2027` (used as the hero/gallery source for the upcoming
 *    Mongolia 2027 rally rather than creating a separate "mongolia-2026" media set).
 */
export function rallyFolderToSlug(folderName: string): string {
  if (folderName === 'Peru_2025') return 'peru-2026';
  if (folderName === 'Mongolia_2026') return 'mongolia-2027';
  const m = folderName.match(/^(.+)_(\d{4})$/);
  if (!m) return kebab(folderName);
  return `${kebab(m[1])}-${m[2]}`;
}

/** `02_Our_Story` -> `our-story` (strip the ordering prefix, kebab the rest). */
export function siteFolderShortName(folderName: string): string {
  return kebab(folderName.replace(/^\d+_/, ''));
}

/** `Hero_Slide_01_Mongolia_Riding.jpg` -> `hero-slide-01-mongolia-riding`. */
export function fileSlug(fileName: string): string {
  return kebab(path.basename(fileName, path.extname(fileName)));
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && IMAGE_EXT.test(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

function discoverRallyPhotos(root: string): UploadItem[] {
  const base = path.join(root, 'RfR Rally Page photos');
  const items: UploadItem[] = [];
  for (const folder of listDirs(base)) {
    const slug = rallyFolderToSlug(folder);
    const files = listFiles(path.join(base, folder));
    files.forEach((file, i) => {
      items.push({
        key: `rfr/rallies/${slug}/${i + 1}.webp`,
        source: path.join(base, folder, file),
        maxDim: RALLY_LONG_EDGE,
      });
    });
  }
  return items;
}

function discoverPortraits(
  root: string,
  subdir: string,
  bucket: 'rangers' | 'riders'
): UploadItem[] {
  const base = path.join(root, subdir);
  const items: UploadItem[] = [];
  const walk = (dir: string) => {
    for (const file of listFiles(dir)) {
      const stem = path.basename(file, path.extname(file));
      const key = `rfr/${bucket}/${kebab(nameKeyFromFileStem(stem))}.webp`;
      items.push({ key, source: path.join(dir, file), maxDim: PORTRAIT_LONG_EDGE });
    }
    for (const sub of listDirs(dir)) walk(path.join(dir, sub));
  };
  walk(base);
  return items;
}

function discoverStaffBios(root: string): UploadItem[] {
  const base = path.join(root, 'Staff Bios');
  return listFiles(base).map(file => ({
    key: `rfr/team/${kebab(path.basename(file, path.extname(file)))}.webp`,
    source: path.join(base, file),
    maxDim: PORTRAIT_LONG_EDGE,
  }));
}

/** `Testimonial_Altangerel_Narantsetseg_Ranger.jpg` -> `altangerel-narantsetseg`. */
export function testimonialSlug(fileName: string): string {
  const stem = path.basename(fileName, path.extname(fileName));
  const withoutPrefix = stem.replace(/^Testimonial[_-]?/i, '');
  const withoutRole = withoutPrefix.replace(/[_-](Ranger|Rider)$/i, '');
  return kebab(withoutRole);
}

function discoverSiteImages(root: string): UploadItem[] {
  const base = path.join(root, 'Website_Section_Images');
  const items: UploadItem[] = [];
  for (const folder of listDirs(base)) {
    const shortName = siteFolderShortName(folder);
    const isTestimonial = shortName === 'testimonials';
    for (const file of listFiles(path.join(base, folder))) {
      const slug = isTestimonial ? testimonialSlug(file) : fileSlug(file);
      items.push({
        key: isTestimonial ? `rfr/testimonials/${slug}.webp` : `rfr/site/${shortName}/${slug}.webp`,
        source: path.join(base, folder, file),
        maxDim: SITE_LONG_EDGE,
      });
    }
  }
  return items;
}

/** Build the full upload plan by walking every known asset directory under `root`. */
export function discoverAssets(root: string = ASSETS_ROOT): UploadItem[] {
  return [
    ...discoverRallyPhotos(root),
    ...discoverPortraits(root, 'Ranger_Portraits', 'rangers'),
    ...discoverPortraits(root, 'Rider_Portraits', 'riders'),
    ...discoverStaffBios(root),
    ...discoverSiteImages(root),
  ];
}

/** De-duplicate by key, keeping the first occurrence (stable ordering). */
export function dedupeByKey(items: UploadItem[]): UploadItem[] {
  const seen = new Set<string>();
  const result: UploadItem[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    result.push(item);
  }
  return result;
}
