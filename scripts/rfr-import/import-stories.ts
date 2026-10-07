/**
 * Rally for Rangers — Stories importer
 *
 * Seeds 4 `Story` rows (type IMPACT, status PUBLISHED):
 *  - mongolia-2023, mongolia-2024: the fuller cinematic block vocabulary (hero -> statement
 *    -> split -> horizontal gallery -> chapters -> riders -> quote -> masonry -> stats ->
 *    closing), built in `buildCinematicContent()` below from `data/stories-cinematic.json`
 *    (real narrative lifted from the hand-built frontend story pages, real local
 *    `/rallies/<year>/*` photos for the split/horizontal/chapters/riders blocks) plus the
 *    manifest's B2-hosted gallery for the masonry block.
 *  - mongolia-2025, peru-2026: the lighter vocabulary (hero -> statement -> text -> masonry
 *    -> stats -> closing), composed from the spreadsheet rally's Main Content / Risk Summary
 *    / More Info text — unchanged from the original importer.
 *
 * Stats are only included when sourced from real copy or the "Riders by Rally" group
 * headers — never invented.
 *
 * Idempotent: upsert by (slug, tenantId). No deletes.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-stories.ts --print   # offline preview
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-stories.ts          # dry run
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-stories.ts --commit # apply
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { readManifest, rallyImages } from './lib/manifest';
import { loadRiderGroups, riderCountFor } from './lib/rider-groups';
import { dataDrivenImpact, dataDrivenStoryContent, RallySheetRow } from './lib/story-content';
import { APPLY_CTA, ImpactSummary, StoryBlock } from './lib/story-blocks';

const TENANT_SLUG = 'rally-for-rangers';
const SHEET_FILE = path.join(__dirname, 'data', 'website-data-2026-09.json');
const CINEMATIC_FILE = path.join(__dirname, 'data', 'stories-cinematic.json');

/**
 * The fuller block vocabulary (spec 2026-10-06 §3) — `split`, `riders`, and a `gallery`
 * `layout` of `"horizontal"` or `"drag"` aren't in `lib/story-blocks.ts`'s `StoryBlock` union
 * yet, so this importer builds its own superset locally rather than widening that shared
 * type. The frontend's `parseStoryContent` validates these against its own (already-widened)
 * zod schema at render time — this is just the shape written to `Story.content`.
 */
type CinematicBlock =
  | StoryBlock
  | { type: 'split'; heading?: string; text: string; image: string; reverse?: boolean }
  | { type: 'riders'; title?: string; portraits: Array<{ src: string }> }
  | {
      type: 'gallery';
      images: Array<{ src: string; caption?: string }>;
      layout: 'horizontal' | 'drag';
    }
  | {
      type: 'chapters';
      items: Array<{ title: string; subtitle?: string; body: string; image?: string }>;
    };

interface CinematicContent {
  version: 1;
  blocks: CinematicBlock[];
}

interface CinematicStoryData {
  heroSubtitle: string;
  statementEyebrow: string;
  statementText: string;
  splitHeading: string;
  splitText: string;
  splitImage: string;
  horizontalImages: string[];
  chapters: Array<{ day: string; title: string; image: string }>;
  ridersTitle: string;
  ridersPortraits: string[];
  quoteText: string;
  quoteMeta: string;
  closingTitle: string;
  closingSubtitle: string;
}

function readCinematicData(): Record<string, CinematicStoryData> {
  return JSON.parse(fs.readFileSync(CINEMATIC_FILE, 'utf-8'));
}

/**
 * Builds the fuller vocabulary for mongolia-2023/2024: hero -> statement -> split (real
 * narrative + a real local photo) -> horizontal gallery (real local photos) -> chapters
 * (real day/location labels from the hand-built page) -> riders (real local portraits) ->
 * quote -> masonry (manifest gallery, if any) -> stats -> closing.
 */
function buildCinematicContent(
  title: string,
  heroImage: string | null,
  manifestGallery: string[],
  riderCount: number | null,
  statsExtra: Array<{ value: string; label: string }>,
  data: CinematicStoryData
): CinematicContent {
  const blocks: CinematicBlock[] = [
    { type: 'hero', title, subtitle: data.heroSubtitle, image: heroImage ?? '' },
    { type: 'statement', eyebrow: data.statementEyebrow, text: data.statementText },
    { type: 'split', heading: data.splitHeading, text: data.splitText, image: data.splitImage },
    {
      type: 'gallery',
      layout: 'horizontal',
      images: data.horizontalImages.map(src => ({ src })),
    },
    {
      type: 'chapters',
      items: data.chapters.map(c => ({
        title: c.title,
        subtitle: c.day,
        body: c.title,
        image: c.image,
      })),
    },
    {
      type: 'riders',
      title: data.ridersTitle,
      portraits: data.ridersPortraits.map(src => ({ src })),
    },
    { type: 'quote', text: data.quoteText, meta: data.quoteMeta },
  ];

  if (manifestGallery.length) {
    blocks.push({
      type: 'gallery',
      layout: 'masonry',
      images: manifestGallery.map(src => ({ src })),
    });
  }

  const statsItems: Array<{ value: string; label: string }> = [...statsExtra];
  if (riderCount) statsItems.push({ value: String(riderCount), label: 'Riders' });
  if (statsItems.length) blocks.push({ type: 'stats', items: statsItems });

  blocks.push({
    type: 'closing',
    title: data.closingTitle,
    subtitle: data.closingSubtitle,
    cta: APPLY_CTA,
  });

  return { version: 1, blocks };
}

interface MappedStory {
  slug: string;
  rallySlug: string;
  title: string;
  excerpt: string;
  content: CinematicContent;
  impactSummary: ImpactSummary;
  featuredImage: string | null;
}

type TitledRallyRow = RallySheetRow & { Title: string };

function findRallyRow(title: string): RallySheetRow {
  const sheets = JSON.parse(fs.readFileSync(SHEET_FILE, 'utf-8'));
  const rows: TitledRallyRow[] = sheets['Rallies'];
  const row = rows.find(r => r.Title === title);
  if (!row) throw new Error(`Rally row not found for title "${title}"`);
  return row;
}

function findTestimonialQuote(mentionsAll: string[]): { text: string; author: string } | undefined {
  const sheets = JSON.parse(fs.readFileSync(SHEET_FILE, 'utf-8'));
  const rows: Array<{ Name: string; 'Position / Role': string; Quote: string }> =
    sheets['Testimonials'];
  const hit = rows.find(r =>
    mentionsAll.some(m => (r['Position / Role'] || '').toLowerCase().includes(m.toLowerCase()))
  );
  return hit ? { text: hit.Quote.trim(), author: hit.Name.trim() } : undefined;
}

function buildStories(): MappedStory[] {
  const manifest = readManifest();
  const riderGroups = loadRiderGroups(SHEET_FILE);
  const cinematicData = readCinematicData();

  const mongolia2023Images = rallyImages(manifest, 'mongolia-2023');
  const mongolia2024Images = rallyImages(manifest, 'mongolia-2024');
  const mongolia2025Images = rallyImages(manifest, 'mongolia-2025');
  const peru2026Images = rallyImages(manifest, 'peru-2026');

  const mongolia2025Row = findRallyRow('Mongolia - 2025');
  const peru2026Row = findRallyRow('Peru');

  const mongolia2023Riders = riderCountFor(riderGroups, 2023, 'Southern Mongolia');
  const mongolia2024Riders = riderCountFor(riderGroups, 2024, 'Lake Hovsgol');
  const mongolia2025Riders = riderCountFor(riderGroups, 2025, 'Great Gobi A');
  const peru2026Riders = riderCountFor(riderGroups, 2026, 'Peru'); // null — rally hasn't happened yet

  return [
    {
      slug: 'mongolia-2023',
      rallySlug: 'mongolia-2023',
      title: 'Mongolia 2023',
      excerpt:
        'Ten days across the Southern Mongolian steppe, delivering motorcycles to the rangers who protect it.',
      content: buildCinematicContent(
        'Mongolia 2023',
        mongolia2023Images.hero,
        mongolia2023Images.gallery,
        mongolia2023Riders,
        [{ value: '1,800 km', label: 'Distance' }],
        cinematicData['mongolia-2023']
      ),
      impactSummary: {
        ...(mongolia2023Riders ? { riders: mongolia2023Riders } : {}),
        kilometers: 1800,
      },
      featuredImage: mongolia2023Images.hero,
    },
    {
      slug: 'mongolia-2024',
      rallySlug: 'mongolia-2024',
      title: 'Mongolia 2024',
      excerpt:
        'A decade of impact: returning to Lake Hovsgol, where Rally for Rangers began, to donate 15 more motorcycles.',
      content: buildCinematicContent(
        'Mongolia 2024',
        mongolia2024Images.hero,
        mongolia2024Images.gallery,
        mongolia2024Riders,
        [
          { value: '1,300 km', label: 'Distance' },
          { value: '15', label: 'Motorcycles' },
        ],
        cinematicData['mongolia-2024']
      ),
      impactSummary: {
        ...(mongolia2024Riders ? { riders: mongolia2024Riders } : {}),
        kilometers: 1300,
        bikes: 15,
      },
      featuredImage: mongolia2024Images.hero,
    },
    {
      slug: 'mongolia-2025',
      rallySlug: 'mongolia-2025',
      title: 'Mongolia 2025',
      excerpt:
        'Supporting the 23 rangers of the Great Gobi A Strictly Protected Area, an area larger than Switzerland.',
      content: dataDrivenStoryContent(mongolia2025Row, mongolia2025Images, {
        title: 'Mongolia 2025',
        closingSubtitle: 'Join the next rally',
        matchingTestimonialQuote: findTestimonialQuote(['great gobi']),
        kilometers: null, // "Travel distance: TBD" in the source — not invented
        riderCount: mongolia2025Riders,
      }),
      impactSummary: dataDrivenImpact({ kilometers: null, riderCount: mongolia2025Riders }),
      featuredImage: mongolia2025Images.hero,
    },
    {
      slug: 'peru-2026',
      rallySlug: 'peru-2026',
      title: 'Peru 2026',
      excerpt:
        'From Pacific coastal deserts to the Andes and the Amazon — delivering motorcycles to rangers across Peru’s national parks.',
      content: dataDrivenStoryContent(peru2026Row, peru2026Images, {
        title: 'Peru 2026',
        closingSubtitle: 'Apply for the 2026 Peru rally',
        matchingTestimonialQuote: findTestimonialQuote(['peru rally 2026']),
        kilometers: 1600,
        riderCount: peru2026Riders,
      }),
      impactSummary: dataDrivenImpact({ kilometers: 1600, riderCount: peru2026Riders }),
      featuredImage: peru2026Images.hero,
    },
  ];
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const printOnly = args.has('--print');
  const commit = args.has('--commit');

  const stories = buildStories();

  if (printOnly) {
    console.log(`\n📋 ${stories.length} stories mapped (offline preview, no DB):\n`);
    for (const s of stories) {
      console.log(
        `• ${s.slug.padEnd(16)} blocks:${s.content.blocks.length}  impact:${JSON.stringify(s.impactSummary)}`
      );
    }
    return;
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);
    console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

    const rallyRows = await prisma.rally.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, slug: true },
    });
    const rallyIdBySlug = new Map(rallyRows.map(r => [r.slug, r.id]));

    const existing = await prisma.story.findMany({
      where: { tenantId: tenant.id, type: 'IMPACT' },
      select: { slug: true },
    });
    const existingSlugs = new Set(existing.map(e => e.slug));
    console.log(`ℹ️  Existing IMPACT stories: ${existing.map(e => e.slug).join(', ') || '(none)'}`);
    console.log(`📋 Plan — upsert ${stories.length} stories`);
    for (const s of stories) {
      const rallyId = rallyIdBySlug.get(s.rallySlug);
      console.log(
        `  ${existingSlugs.has(s.slug) ? 'UPDATE' : 'CREATE'}  ${s.slug.padEnd(16)} rallyId:${rallyId ? 'ok' : 'MISSING'}`
      );
    }

    if (!commit) {
      console.log('\n🚫 Dry run — nothing written. Re-run with --commit to apply.');
      return;
    }

    const adminUser = await prisma.user.upsert({
      where: { email_tenantId: { email: 'admin@rally-for-rangers.org', tenantId: tenant.id } },
      update: {},
      create: {
        email: 'admin@rally-for-rangers.org',
        firstName: 'Rally',
        lastName: 'Admin',
        password: await bcrypt.hash('changeme-' + Math.random().toString(36).slice(2), 12),
        isActive: true,
        emailVerified: true,
        tenantId: tenant.id,
      },
    });

    let created = 0;
    let updated = 0;
    for (const s of stories) {
      const rallyId = rallyIdBySlug.get(s.rallySlug) ?? null;
      const common = {
        title: { en: s.title, mn: '' },
        excerpt: { en: s.excerpt, mn: '' },
        content: s.content as object,
        impactSummary: s.impactSummary as object,
        featuredImage: s.featuredImage,
        type: 'IMPACT' as const,
        status: 'PUBLISHED' as const,
        publishedAt: new Date(),
        rallyId,
      };
      const wasExisting = existingSlugs.has(s.slug);
      await prisma.story.upsert({
        where: { slug_tenantId: { slug: s.slug, tenantId: tenant.id } },
        update: common,
        create: { ...common, slug: s.slug, tenantId: tenant.id, createdById: adminUser.id },
      });
      wasExisting ? updated++ : created++;
      console.log(`  ✅ ${wasExisting ? 'updated' : 'created'} ${s.slug}`);
    }
    // Demo IMPACT stories from the June seed are archived so only real rally stories publish.
    const SEED_PLACEHOLDER_SLUGS = ['hustai-2025-impact-report'];
    const archived = await prisma.story.updateMany({
      where: { tenantId: tenant.id, slug: { in: SEED_PLACEHOLDER_SLUGS }, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    });
    console.log(`\n🎉 Done. Created ${created}, updated ${updated}, archived ${archived.count} seed placeholders.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
