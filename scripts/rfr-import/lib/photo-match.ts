/**
 * Rally for Rangers — portrait matching.
 *
 * Pure lookup: given a person's full name and the image manifest, find the best-matching
 * `rfr/<bucket>/*.webp` entry by normalised-name comparison.
 */
import { Manifest } from './manifest';
import { nameMatchCandidates } from './text';

export type PortraitBucket = 'riders' | 'rangers' | 'team' | 'testimonials';

/** Build `normalised-key -> url` for a single bucket, once, so repeated lookups are O(1). */
export function buildBucketIndex(manifest: Manifest, bucket: PortraitBucket): Map<string, string> {
  const prefix = `rfr/${bucket}/`;
  const index = new Map<string, string>();
  for (const [key, entry] of Object.entries(manifest)) {
    if (!key.startsWith(prefix)) continue;
    const slug = key.slice(prefix.length).replace(/\.webp$/, '');
    index.set(slug.replace(/-/g, ' '), entry.url);
  }
  return index;
}

/** Returns the manifest URL for the best name match, or null if nothing matches. */
export function matchPortrait(fullName: string, index: Map<string, string>): string | null {
  for (const candidate of nameMatchCandidates(fullName)) {
    const hit = index.get(candidate);
    if (hit) return hit;
  }
  return null;
}
