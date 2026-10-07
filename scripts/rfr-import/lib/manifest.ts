/**
 * Rally for Rangers — image manifest read/write helpers.
 *
 * The manifest (`data/image-manifest.json`) maps every uploaded B2 object key to its public
 * URL plus provenance (local source path, pixel dimensions). Importers read it; only
 * `upload-images.ts` writes it.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ManifestEntry {
  url: string;
  source: string;
  width: number;
  height: number;
}

export type Manifest = Record<string, ManifestEntry>;

export const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'image-manifest.json');

export function readManifest(manifestPath: string = MANIFEST_PATH): Manifest {
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

export function writeManifest(manifest: Manifest, manifestPath: string = MANIFEST_PATH): void {
  const sorted: Manifest = {};
  for (const key of Object.keys(manifest).sort()) sorted[key] = manifest[key];
  fs.writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

/** All manifest entries whose key starts with the given prefix (e.g. `rfr/rallies/mongolia-2024/`). */
export function manifestEntriesByPrefix(
  manifest: Manifest,
  prefix: string
): Array<{ key: string; entry: ManifestEntry }> {
  return Object.entries(manifest)
    .filter(([key]) => key.startsWith(prefix))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([key, entry]) => ({ key, entry }));
}

/** Public URLs for a rally slug: hero = first rally image, gallery = the rest. */
export function rallyImages(
  manifest: Manifest,
  slug: string
): { hero: string | null; gallery: string[] } {
  const entries = manifestEntriesByPrefix(manifest, `rfr/rallies/${slug}/`);
  const urls = entries.map(e => e.entry.url);
  return { hero: urls[0] ?? null, gallery: urls.slice(1) };
}
