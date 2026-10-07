/**
 * Rally for Rangers — Story content block types (spec 2026-10-06 §1.3).
 *
 * The frontend renders unknown block types as nothing, so this union only needs to match
 * what the renderer actually understands — no need to be exhaustive beyond that contract.
 */

export interface HeroBlock {
  type: 'hero';
  title: string;
  subtitle?: string;
  image: string;
  video?: string;
}

export interface StatementBlock {
  type: 'statement';
  eyebrow?: string;
  text: string;
}

export interface TextBlock {
  type: 'text';
  heading?: string;
  body: string;
}

export interface ImageBlock {
  type: 'image';
  src: string;
  caption?: string;
  parallax?: boolean;
}

export interface GalleryBlock {
  type: 'gallery';
  images: Array<{ src: string; caption?: string }>;
  layout: 'masonry' | 'horizontal' | 'fullscreen';
}

export interface QuoteBlock {
  type: 'quote';
  text: string;
  author?: string;
  meta?: string;
}

export interface StatsBlock {
  type: 'stats';
  items: Array<{ value: string; label: string }>;
}

export interface ClosingBlock {
  type: 'closing';
  title: string;
  subtitle?: string;
  image?: string;
  cta?: { label: string; href: string };
}

export type StoryBlock =
  | HeroBlock
  | StatementBlock
  | TextBlock
  | ImageBlock
  | GalleryBlock
  | QuoteBlock
  | StatsBlock
  | ClosingBlock;

export interface StoryContent {
  version: 1;
  blocks: StoryBlock[];
}

export interface ImpactSummary {
  riders?: number;
  kilometers?: number;
  bikes?: number;
}

export const APPLY_CTA = { label: 'Apply for the next rally', href: '/apply' } as const;
