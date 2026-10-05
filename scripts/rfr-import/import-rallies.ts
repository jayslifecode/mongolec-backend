/**
 * Rally for Rangers — Rallies importer
 *
 * Source: scripts/rfr-import/data/rallies.json (extracted from RallyForRangers_WebsiteData.xlsx)
 * Plus one manager-requested upcoming rally: Mongolia 2027.
 *
 * Maps each source row to a Prisma `Rally` upsert (keyed on slug + tenantId — no deletes).
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-rallies.ts --print   # offline, no DB — just show mapping
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-rallies.ts           # dry run: read DB, show plan, write nothing
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-rallies.ts --commit  # write upserts to DATABASE_URL
 *
 * Target DB is whatever DATABASE_URL points to. For production, run with the prod DATABASE_URL.
 */
import { PrismaClient, RallyStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const TENANT_SLUG = 'rally-for-rangers';
const DATA_FILE = path.join(__dirname, 'data', 'rallies.json');
// Rallies in this year or later are "Upcoming"; everything earlier is "Past" (COMPLETED).
const UPCOMING_FROM_YEAR = 2027;

type SourceRally = {
  Title: string;
  'Slug (URL)': string;
  'Date Added': string;
  'Country / Rally Name': string;
  'Travel Distance (km)': string;
  'Gallery Image URLs': string;
  'Main Content': string;
  'Risk Summary': string;
  'Risk Detail': string;
  'More Info / Park Detail': string;
};

type MappedRally = {
  slug: string;
  title: { en: string; mn: string };
  description: { en: string; mn: string };
  location: { en: string; mn: string };
  startDate: Date;
  endDate: Date;
  duration: number;
  status: RallyStatus;
  isRecruiting: boolean;
  heroImage: string | null;
  gallery: string[];
  highlights: string[];
  impactOverview: { en: string; mn: string };
  conservationActivities: string[];
  rangerPartnerships: { en: string; mn: string };
  targetAudience: string[];
};

const DEFAULT_TARGET_AUDIENCE = [
  'Adventure motorcycle riders',
  'Conservation and wildlife enthusiasts',
  'Supporters who want to fund rangers without riding',
];

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Pull a 4-digit year out of the title (e.g. "Mongolia - 2024" -> 2024). */
function parseYear(title: string): number | null {
  const m = title.match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/** Normalize messy source slugs to a clean `<country>-<year>`. */
function buildSlug(countryRaw: string, year: number | null): string {
  const country = countryRaw
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/^-|-$/g, '');
  return year ? `${country}-${year}` : country;
}

/** Best-effort start date from a "Date: July 21-Aug 03, 2024" line; falls back to mid-July of the year. */
function parseDates(content: string, year: number): { start: Date; end: Date; duration: number } {
  const fallbackStart = new Date(Date.UTC(year, 6, 15));
  const fallbackEnd = new Date(Date.UTC(year, 6, 28));
  const line = content.match(/Date:\s*([^\r\n]+)/i);
  if (line) {
    // e.g. "July 21-Aug 03, 2024"  or  "Aug 1-14, 2023"
    const m = line[1].match(
      /([A-Za-z]{3,})\s*(\d{1,2})\s*[-–to]+\s*(?:([A-Za-z]{3,})\s*)?(\d{1,2})/
    );
    if (m) {
      const m1 = MONTHS[m[1].slice(0, 3).toLowerCase()];
      const d1 = parseInt(m[2], 10);
      const m2 = m[3] ? MONTHS[m[3].slice(0, 3).toLowerCase()] : m1;
      const d2 = parseInt(m[4], 10);
      if (m1 !== undefined && m2 !== undefined) {
        const start = new Date(Date.UTC(year, m1, d1));
        const end = new Date(Date.UTC(year, m2, d2));
        if (end >= start) {
          const duration = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
          return { start, end, duration };
        }
      }
    }
  }
  return { start: fallbackStart, end: fallbackEnd, duration: 14 };
}

function parseGallery(raw: string): string[] {
  return (raw || '')
    .split(/[\s,]+/)
    .map(u => u.trim())
    .filter(u => /^https?:\/\//i.test(u) && /\.(jpe?g|png|webp|gif)$/i.test(u));
}

function splitLines(raw: string): string[] {
  return (raw || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function mapRally(src: SourceRally): MappedRally {
  // Year may live in the title, the slug ("peru-2026"), or the Date Added column.
  const year = parseYear(src.Title) ?? parseYear(src['Slug (URL)']) ?? parseYear(src['Date Added']);
  const country = (src['Country / Rally Name'] || src.Title.split('-')[0]).trim();
  const { start, end, duration } = parseDates(
    src['Main Content'],
    year ?? new Date().getUTCFullYear()
  );
  const gallery = parseGallery(src['Gallery Image URLs']);
  const distance = (src['Travel Distance (km)'] || '').trim();
  const distanceInContent = src['Main Content'].match(/Travel distance:\s*([\d,]+)\s*km/i);
  const km = distance || (distanceInContent ? distanceInContent[1] : '');

  // Per the manager's content doc, only Mongolia 2027 (and later) is "Upcoming"; everything
  // through 2026 is treated as a Past rally.
  const isUpcoming = year !== null && year >= UPCOMING_FROM_YEAR;

  const highlights: string[] = [];
  if (km) highlights.push(`Traveled approximately ${km} km`);

  // Park name is the first line of Main Content (e.g. "Lake Hovsgol National Park").
  // Use it as the location only if it reads like a place name (short, no metadata).
  const firstLine = splitLines(src['Main Content'])[0] || '';
  const looksLikePlace =
    firstLine.length > 0 && firstLine.length <= 60 && !/travel distance|date:/i.test(firstLine);
  const placeName = looksLikePlace ? firstLine : '';
  const locationEn = placeName ? `${placeName}, ${country}` : country;

  return {
    slug: buildSlug(country, year),
    title: { en: `${country} ${year ?? ''}`.trim(), mn: '' },
    description: { en: src['Main Content'].trim(), mn: '' },
    location: { en: locationEn, mn: '' },
    startDate: start,
    endDate: end,
    duration,
    status: isUpcoming ? RallyStatus.UPCOMING : RallyStatus.COMPLETED,
    isRecruiting: isUpcoming,
    heroImage: gallery[0] ?? null,
    gallery,
    highlights,
    impactOverview: { en: (src['Risk Summary'] || src['More Info / Park Detail']).trim(), mn: '' },
    conservationActivities: splitLines(src['Risk Detail']).slice(0, 8),
    rangerPartnerships: { en: src['More Info / Park Detail'].trim(), mn: '' },
    targetAudience: DEFAULT_TARGET_AUDIENCE,
  };
}

/** Manager-requested upcoming rally not present in the spreadsheet. */
function mongolia2027(): MappedRally {
  return {
    slug: 'mongolia-2027',
    title: { en: 'Mongolia 2027', mn: 'Монгол 2027' },
    description: {
      en: 'Mongolia 2027 — details coming soon. Ride across Mongolia and personally deliver a new motorcycle to a park ranger on the front lines of conservation. More 2027 rallies will be announced soon.',
      mn: '',
    },
    location: { en: 'Mongolia', mn: 'Монгол' },
    startDate: new Date(Date.UTC(2027, 6, 15)),
    endDate: new Date(Date.UTC(2027, 6, 28)),
    duration: 14,
    status: RallyStatus.UPCOMING,
    isRecruiting: true,
    heroImage: null,
    gallery: [],
    highlights: ['More 2027 rallies coming soon'],
    impactOverview: {
      en: 'Each rally delivers new motorcycles directly to park rangers, extending their patrol range and protecting vast wild landscapes.',
      mn: '',
    },
    conservationActivities: [],
    rangerPartnerships: {
      en: 'In partnership with the Mongol Ecology Center and Mongolian protected-area administrations.',
      mn: '',
    },
    targetAudience: DEFAULT_TARGET_AUDIENCE,
  };
}

function loadMapped(): MappedRally[] {
  const source: SourceRally[] = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const hasYear = (r: SourceRally) =>
    parseYear(r.Title) ?? parseYear(r['Slug (URL)']) ?? parseYear(r['Date Added']);
  const mapped = source.filter(r => r.Title && hasYear(r)).map(mapRally);
  // De-dup by slug (last wins), then add Mongolia 2027.
  const bySlug = new Map<string, MappedRally>();
  for (const r of mapped) bySlug.set(r.slug, r);
  bySlug.set('mongolia-2027', mongolia2027());
  return Array.from(bySlug.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const printOnly = args.has('--print');
  const commit = args.has('--commit');

  const rallies = loadMapped();

  if (printOnly) {
    console.log(`\n📋 ${rallies.length} rallies mapped (offline preview, no DB):\n`);
    for (const r of rallies) {
      console.log(
        `• ${r.slug.padEnd(16)} ${r.status.padEnd(10)} ${r.startDate.toISOString().slice(0, 10)}→${r.endDate
          .toISOString()
          .slice(0, 10)}  imgs:${r.gallery.length}  "${r.title.en}"`
      );
    }
    console.log('\nSample (first record):\n', JSON.stringify(rallies[0], null, 2));
    return;
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant)
      throw new Error(`Tenant '${TENANT_SLUG}' not found in this database (${maskedDbHost()}).`);
    console.log(`✅ Tenant: ${tenant.name} (${tenant.id})  @ ${maskedDbHost()}`);

    const existing = await prisma.rally.findMany({
      where: { tenantId: tenant.id },
      select: { slug: true, status: true },
    });
    const existingSlugs = new Set(existing.map(e => e.slug));
    console.log(
      `ℹ️  ${existing.length} rallies already in DB: ${existing.map(e => e.slug).join(', ') || '(none)'}`
    );

    console.log(`\n📋 Plan (${rallies.length} rallies):`);
    for (const r of rallies) {
      console.log(
        `  ${existingSlugs.has(r.slug) ? 'UPDATE' : 'CREATE'}  ${r.slug.padEnd(16)} ${r.status}`
      );
    }

    if (!commit) {
      console.log('\n🚫 Dry run — nothing written. Re-run with --commit to apply.');
      return;
    }

    // Resolve an admin user to satisfy the required createdBy relation.
    const hashedPassword = await bcrypt.hash('changeme-' + Math.random().toString(36).slice(2), 12);
    const adminUser = await prisma.user.upsert({
      where: { email_tenantId: { email: 'admin@rally-for-rangers.org', tenantId: tenant.id } },
      update: {},
      create: {
        email: 'admin@rally-for-rangers.org',
        firstName: 'Rally',
        lastName: 'Admin',
        password: hashedPassword,
        isActive: true,
        emailVerified: true,
        tenantId: tenant.id,
      },
    });

    let created = 0;
    let updated = 0;
    for (const r of rallies) {
      const common = {
        title: r.title,
        description: r.description,
        location: r.location,
        startDate: r.startDate,
        endDate: r.endDate,
        duration: r.duration,
        status: r.status,
        isRecruiting: r.isRecruiting,
        heroImage: r.heroImage,
        gallery: r.gallery,
        highlights: r.highlights,
        impactOverview: r.impactOverview,
        conservationActivities: r.conservationActivities,
        rangerPartnerships: r.rangerPartnerships,
        targetAudience: r.targetAudience,
      };
      const wasExisting = existingSlugs.has(r.slug);
      await prisma.rally.upsert({
        where: { slug_tenantId: { slug: r.slug, tenantId: tenant.id } },
        update: common,
        create: { ...common, slug: r.slug, tenantId: tenant.id, createdById: adminUser.id },
      });
      wasExisting ? updated++ : created++;
      console.log(`  ✅ ${wasExisting ? 'updated' : 'created'} ${r.slug}`);
    }
    console.log(`\n🎉 Done. Created ${created}, updated ${updated}.`);
  } finally {
    await prisma.$disconnect();
  }
}

function maskedDbHost(): string {
  const url = process.env.DATABASE_URL || '';
  const m = url.match(/@([^/:]+)/);
  return m ? m[1] : 'unknown-host';
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
