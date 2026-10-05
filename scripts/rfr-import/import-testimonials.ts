/**
 * Rally for Rangers — Testimonials importer
 *
 * Source: scripts/rfr-import/data/website-data-2026-09.json ("Testimonials" sheet — the fresh
 * 2026-09-22 spreadsheet dump). Creates Story records (type TESTIMONIAL, status PUBLISHED)
 * which the homepage carousel reads via getPublishedStories(type: TESTIMONIAL). Archives the
 * 3 seed placeholder testimonials so only the real quotes show.
 *
 * featuredImage is matched from scripts/rfr-import/data/image-manifest.json
 * (`rfr/testimonials/*`) by normalised name; falls back to the spreadsheet Photo URL.
 *
 * Idempotent: upsert by (slug, tenantId). No deletes.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-testimonials.ts --print   # offline preview
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-testimonials.ts           # dry run
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-testimonials.ts --commit  # apply
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { buildBucketIndex, matchPortrait } from './lib/photo-match';
import { readManifest } from './lib/manifest';
import { kebab } from './lib/text';

const TENANT_SLUG = 'rally-for-rangers';
const DATA_FILE = path.join(__dirname, 'data', 'website-data-2026-09.json');
// Placeholder testimonials from the original sample seed — archive so they drop off the carousel.
const PLACEHOLDER_SLUGS = [
  'michael-torres-mongolia-2025',
  'batbold-naran-ranger-story',
  'sarah-kim-peru-preview',
];

type Row = {
  Name: string;
  'Position / Role': string;
  Quote: string;
  Type: string;
  'Photo URL': string;
};

function mapRows() {
  const sheets = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const rows: Row[] = sheets['Testimonials'];
  const manifest = readManifest();
  const index = buildBucketIndex(manifest, 'testimonials');
  return rows
    .filter(r => r.Name && r.Quote)
    .map((r, i) => {
      const rawPhoto = (r['Photo URL'] || '').trim();
      return {
        slug: `${kebab(r.Name)}-testimonial`,
        title: { en: r.Name.trim(), mn: '' },
        content: { en: r.Quote.trim(), mn: '' },
        excerpt: { en: (r['Position / Role'] || '').trim(), mn: '' },
        author: { en: r.Name.trim(), mn: '' },
        role: (r['Position / Role'] || r.Type || '').trim(),
        featuredImage:
          matchPortrait(r.Name, index) ?? (/^https?:\/\//i.test(rawPhoto) ? rawPhoto : null),
        displayOrder: i,
      };
    });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const printOnly = args.has('--print');
  const commit = args.has('--commit');

  const items = mapRows();

  if (printOnly) {
    console.log(`\n📋 ${items.length} testimonials mapped:\n`);
    items.forEach(t =>
      console.log(`  ${t.slug.padEnd(28)} ${t.author.en} | ${t.role.slice(0, 50)}`)
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);
    console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

    const existing = await prisma.story.findMany({
      where: { tenantId: tenant.id, type: 'TESTIMONIAL' },
      select: { slug: true, status: true },
    });
    console.log(
      `ℹ️  Existing TESTIMONIAL stories: ${existing.map(e => `${e.slug}(${e.status})`).join(', ') || '(none)'}`
    );
    console.log(
      `📋 Plan — upsert ${items.length} real testimonials; archive ${PLACEHOLDER_SLUGS.length} placeholders.`
    );

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

    for (const t of items) {
      const common = {
        title: t.title,
        content: t.content,
        excerpt: t.excerpt,
        author: t.author,
        role: t.role,
        featuredImage: t.featuredImage,
        type: 'TESTIMONIAL' as const,
        status: 'PUBLISHED' as const,
        featured: true,
        displayOrder: t.displayOrder,
      };
      await prisma.story.upsert({
        where: { slug_tenantId: { slug: t.slug, tenantId: tenant.id } },
        update: common,
        create: { ...common, slug: t.slug, tenantId: tenant.id, createdById: adminUser.id },
      });
      console.log(`  ✅ ${t.slug}`);
    }

    const archived = await prisma.story.updateMany({
      where: { tenantId: tenant.id, slug: { in: PLACEHOLDER_SLUGS } },
      data: { status: 'ARCHIVED' },
    });
    console.log(
      `\n🎉 Done. Upserted ${items.length} testimonials, archived ${archived.count} placeholders.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
