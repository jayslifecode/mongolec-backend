/**
 * Rally for Rangers — Story content builders.
 *
 * Pure functions: given manifest images (+ for the data-driven stories, the matching rally
 * spreadsheet row and rider-group counts), build the `{version, blocks}` content and
 * `impactSummary` for each seeded story. No invented numbers — a stat is included only when
 * sourced from real copy (the spreadsheet) or the "Riders by Rally" group headers.
 */
import { APPLY_CTA, ImpactSummary, StoryBlock, StoryContent } from './story-blocks';

export interface RallyImages {
  hero: string | null;
  gallery: string[];
}

export interface RallySheetRow {
  'Main Content': string;
  'Risk Summary': string;
  'More Info / Park Detail': string;
}

function content(blocks: StoryBlock[]): StoryContent {
  return { version: 1, blocks };
}

/** First real paragraph of a rally's "Main Content" (skips the park-name title line and the
 *  Travel distance / Date metadata lines). */
function mainBody(mainContent: string): string {
  return mainContent
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !/^travel distance:/i.test(l) && !/^date:/i.test(l))
    .slice(1) // drop the park-name title line
    .join('\n\n');
}

function parkTitle(mainContent: string): string {
  return mainContent.split(/\r?\n/)[0].trim();
}

// ─── Mongolia 2023 — narrative from the hand-built frontend page (real copy only) ──────────
export function mongolia2023Content(images: RallyImages): StoryContent {
  const gallery = images.gallery.map(src => ({ src }));
  return content([
    {
      type: 'hero',
      title: 'Mongolia 2023',
      subtitle: 'The steppe awaits — our first chapter',
      image: images.hero ?? '',
    },
    {
      type: 'statement',
      eyebrow: 'Mongolia 2023 — where it all began',
      text: 'Dust in our wake, purpose in our hearts.',
    },
    {
      type: 'text',
      heading: 'National Parks of Southern Mongolia',
      body: 'Rally for Rangers donated motorcycles to the Southern Mongolian National Parks, riding roughly 1,800 km across the steppe to reach the rangers who protect it.',
    },
    ...(gallery.length
      ? [{ type: 'gallery', images: gallery, layout: 'masonry' } as StoryBlock]
      : []),
    { type: 'quote', text: 'We came to give. We stayed to belong.', meta: 'The 2023 crew' },
    {
      type: 'closing',
      title: 'The road never ends, it only continues',
      subtitle: 'See you in 2024',
      cta: APPLY_CTA,
    },
  ]);
}

export function mongolia2023Impact(riderCount: number | null): ImpactSummary {
  return { ...(riderCount ? { riders: riderCount } : {}), kilometers: 1800 };
}

// ─── Mongolia 2024 — narrative from the hand-built frontend page (real copy only) ──────────
export function mongolia2024Content(images: RallyImages): StoryContent {
  const gallery = images.gallery.map(src => ({ src }));
  return content([
    {
      type: 'hero',
      title: 'Mongolia 2024',
      subtitle: 'We came back — year two begins',
      image: images.hero ?? '',
    },
    {
      type: 'statement',
      eyebrow: 'Mongolia 2024 — further, harder, better',
      text: 'The mission grew. The bond deepened.',
    },
    {
      type: 'text',
      heading: '10 Years of Rally for Rangers',
      body: 'A Decade of Impact! In honor of this momentous occasion, Rally for Rangers returned to Lake Hovsgol National Park to donate 15 motorcycles — the very place where the spirit of Rally for Rangers was born.\n\nLake Hovsgol, also known as the "Mother Sea," holds 70% of Mongolia’s freshwater and 1% of the Earth’s total freshwater reserve. Established in 1992, this pristine park spans a colossal 1.2 million hectares — surpassing the grandeur of Yellowstone National Park in the US.',
    },
    ...(gallery.length
      ? [{ type: 'gallery', images: gallery, layout: 'masonry' } as StoryBlock]
      : []),
    {
      type: 'quote',
      text: 'Year one you find the road. Year two you become it.',
      meta: 'The 2024 crew',
    },
    {
      type: 'closing',
      title: 'Two years, one mission, endless road',
      subtitle: 'The story continues in 2025',
      cta: APPLY_CTA,
    },
  ]);
}

export function mongolia2024Impact(riderCount: number | null): ImpactSummary {
  return { ...(riderCount ? { riders: riderCount } : {}), kilometers: 1300, bikes: 15 };
}

// ─── Data-driven stories (Mongolia 2025, Peru 2026) — composed from the spreadsheet ────────
export interface DataDrivenStoryOptions {
  title: string;
  closingSubtitle: string;
  matchingTestimonialQuote?: { text: string; author: string; meta?: string };
  kilometers: number | null;
  riderCount: number | null;
}

export function dataDrivenStoryContent(
  row: RallySheetRow,
  images: RallyImages,
  opts: DataDrivenStoryOptions
): StoryContent {
  const title = parkTitle(row['Main Content']);
  const body = mainBody(row['Main Content']);
  const gallery = images.gallery.map(src => ({ src }));
  const blocks: StoryBlock[] = [
    { type: 'hero', title: opts.title, subtitle: title, image: images.hero ?? '' },
    { type: 'statement', text: row['Risk Summary'].trim() || title },
    { type: 'text', heading: title, body },
  ];
  if (gallery.length) blocks.push({ type: 'gallery', images: gallery, layout: 'masonry' });
  if (opts.matchingTestimonialQuote) {
    blocks.push({ type: 'quote', ...opts.matchingTestimonialQuote });
  }
  const statsItems: Array<{ value: string; label: string }> = [];
  if (opts.riderCount) statsItems.push({ value: String(opts.riderCount), label: 'Riders' });
  if (opts.kilometers) statsItems.push({ value: `${opts.kilometers} km`, label: 'Distance' });
  if (statsItems.length) blocks.push({ type: 'stats', items: statsItems });
  blocks.push({
    type: 'closing',
    title: row['More Info / Park Detail'].split(/\r?\n/)[0].trim() || title,
    subtitle: opts.closingSubtitle,
    cta: APPLY_CTA,
  });
  return content(blocks);
}

export function dataDrivenImpact(
  opts: Pick<DataDrivenStoryOptions, 'kilometers' | 'riderCount'>
): ImpactSummary {
  return {
    ...(opts.riderCount ? { riders: opts.riderCount } : {}),
    ...(opts.kilometers ? { kilometers: opts.kilometers } : {}),
  };
}
