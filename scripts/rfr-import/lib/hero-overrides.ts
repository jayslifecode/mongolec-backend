/**
 * Curated hero/gallery overrides (data/hero-overrides.json): promote a specific manifest
 * key to be the rally hero and drop non-photo assets (maps, flyers) from the gallery.
 * Pure: never mutates its inputs.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Manifest } from './manifest';

export interface HeroOverride {
  hero?: string;
  drop?: string[];
  why?: string;
}
export type HeroOverrides = Record<string, HeroOverride>;

export const HERO_OVERRIDES_PATH = path.join(__dirname, '..', 'data', 'hero-overrides.json');

export function readHeroOverrides(filePath: string = HERO_OVERRIDES_PATH): HeroOverrides {
  if (!fs.existsSync(filePath)) return {};
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !key.startsWith('_'))
  ) as HeroOverrides;
}

export function applyHeroOverrides(
  slug: string,
  images: { hero: string | null; gallery: string[] },
  manifest: Manifest,
  overrides: HeroOverrides
): { hero: string | null; gallery: string[] } {
  const override = overrides[slug];
  if (!override) return images;

  const dropUrls = new Set((override.drop ?? []).map(key => manifest[key]?.url).filter(Boolean));
  const ordered = [images.hero, ...images.gallery].filter(
    (url): url is string => Boolean(url) && !dropUrls.has(url as string)
  );
  const heroUrl = override.hero ? manifest[override.hero]?.url : undefined;
  if (override.hero && !heroUrl) {
    console.warn(`  ⚠️  hero override for ${slug} points at unknown manifest key ${override.hero}`);
  }
  const withHeroFirst = heroUrl
    ? [heroUrl, ...ordered.filter(url => url !== heroUrl)]
    : ordered;
  return { hero: withHeroFirst[0] ?? null, gallery: withHeroFirst.slice(1) };
}
