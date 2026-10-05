/**
 * Rally for Rangers — Stories importer
 *
 * Seeds 4 `Story` rows (type IMPACT, status PUBLISHED):
 *  - mongolia-2023, mongolia-2024: narrative from the hand-built frontend story pages
 *    (`app/stories/mongolia-202{3,4}/page.tsx`), which already contain only real copy.
 *  - mongolia-2025, peru-2026: composed from the spreadsheet rally's Main Content / Risk
 *    Summary / More Info text (hero -> statement -> text -> gallery -> quote (only if a
 *    testimonial mentions that rally) -> stats -> closing).
 *
 * Images from the manifest (`rfr/rallies/<slug>/*`); stats only when sourced from real copy
 * or the "Riders by Rally" group headers — never invented.
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
import {
  dataDrivenImpact,
  dataDrivenStoryContent,
  mongolia2023Content,
  mongolia2023Impact,
  mongolia2024Content,
  mongolia2024Impact,
  RallySheetRow,
} from './lib/story-content';
import { ImpactSummary, StoryContent } from './lib/story-blocks';

const TENANT_SLUG = 'rally-for-rangers';
const SHEET_FILE = path.join(__dirname, 'data', 'website-data-2026-09.json');

interface MappedStory {
  slug: string;
  rallySlug: string;
  title: string;
  excerpt: string;
  content: StoryContent;
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

  const mongolia2023Images = rallyImages(manifest, 'mongolia-2023');
  const mongolia2024Images = rallyImages(manifest, 'mongolia-2024');
  const mongolia2025Images = rallyImages(manifest, 'mongolia-2025');
  const peru2026Images = rallyImages(manifest, 'peru-2026');

  const mongolia2025Row = findRallyRow('Mongolia - 2025');
  const peru2026Row = findRallyRow('Peru');

  const mongolia2025Riders = riderCountFor(riderGroups, 2025, 'Great Gobi A');
  const peru2026Riders = riderCountFor(riderGroups, 2026, 'Peru'); // null — rally hasn't happened yet

  return [
    {
      slug: 'mongolia-2023',
      rallySlug: 'mongolia-2023',
      title: 'Mongolia 2023',
      excerpt:
        'Ten days across the Southern Mongolian steppe, delivering motorcycles to the rangers who protect it.',
      content: mongolia2023Content(mongolia2023Images),
      impactSummary: mongolia2023Impact(riderCountFor(riderGroups, 2023, 'Southern Mongolia')),
      featuredImage: mongolia2023Images.hero,
    },
    {
      slug: 'mongolia-2024',
      rallySlug: 'mongolia-2024',
      title: 'Mongolia 2024',
      excerpt:
        'A decade of impact: returning to Lake Hovsgol, where Rally for Rangers began, to donate 15 more motorcycles.',
      content: mongolia2024Content(mongolia2024Images),
      impactSummary: mongolia2024Impact(riderCountFor(riderGroups, 2024, 'Lake Hovsgol')),
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
    console.log(`\n🎉 Done. Created ${created}, updated ${updated}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
