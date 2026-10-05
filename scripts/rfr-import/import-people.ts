/**
 * Rally for Rangers — Riders & Rangers importer
 *
 * Source: scripts/rfr-import/data/riders-by-rally.json (from the "Riders by Rally" sheet).
 * Rows are grouped by a header like "2014  —  Lake Hovsgol National Park - Mongolia  (12 riders)";
 * each person row has Name, Type (Rider|Ranger), Photo URL, Bio.
 *
 * - Riders   -> Participant (+ ParticipantRally links so `rallyYears` populates on the site)
 * - Rangers  -> Ranger
 *
 * Idempotent: records use deterministic IDs (rfr-rider-<slug> / rfr-ranger-<slug>) so re-runs
 * update in place. Photo URLs are kept as-is (already hosted on the old WordPress CDN). No deletes.
 *
 * Usage (inside the backend container, where DATABASE_URL points at prod):
 *   bun run scripts/rfr-import/import-people.ts           # dry run — plan only, no writes
 *   bun run scripts/rfr-import/import-people.ts --commit  # apply
 *   bun run scripts/rfr-import/import-people.ts --print   # offline mapping preview, no DB
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const TENANT_SLUG = 'rally-for-rangers';
const DATA_FILE = path.join(__dirname, 'data', 'riders-by-rally.json');

type Row = {
  '#': string;
  Name: string;
  Type: string;
  'Photo URL': string;
  Bio: string;
  'Position / Notes': string;
};

type RiderAcc = {
  id: string;
  firstName: string;
  lastName: string;
  country: string;
  bio: string;
  photo: string | null;
  displayOrder: number;
  rallies: Map<string, { year: number; slug: string }>; // keyed by slug
};

type RangerAcc = {
  id: string;
  name: string;
  parkName: string;
  country: string;
  bio: string;
  photo: string | null;
  displayOrder: number;
};

function kebab(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function countrySlug(country: string): string {
  return kebab(country);
}

/** Parse a group header: "2014  —  Lake Hovsgol National Park - Mongolia  (12 riders)". */
function parseHeader(s: string): { year: number; park: string; country: string } | null {
  const m = s.match(/^\s*(\d{4})\s*[—-]+\s*(.+?)\s*-\s*([^()]+?)\s*\(/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), park: m[2].trim(), country: m[3].trim() };
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function cleanPhoto(url: string): string | null {
  const u = (url || '').trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

function isHeader(r: Row): boolean {
  return !!r['#'] && !r.Name && !r.Type;
}

function accumulate() {
  const rows: Row[] = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const riders = new Map<string, RiderAcc>();
  const rangers = new Map<string, RangerAcc>();
  let group: { year: number; park: string; country: string } | null = null;
  let riderOrder = 0;
  let rangerOrder = 0;

  for (const r of rows) {
    if (isHeader(r)) {
      group = parseHeader(r['#']);
      continue;
    }
    if (!r.Name || !r.Type) continue;
    const name = r.Name.trim();
    const bio = (r.Bio || '').trim();
    const photo = cleanPhoto(r['Photo URL']);
    const country = group?.country || 'Mongolia';

    if (/ranger/i.test(r.Type)) {
      const id = `rfr-ranger-${kebab(name)}`;
      const existing = rangers.get(id);
      if (existing) {
        if (!existing.bio && bio) existing.bio = bio;
        if (!existing.photo && photo) existing.photo = photo;
      } else {
        rangers.set(id, {
          id,
          name,
          parkName: group?.park || '',
          country,
          bio,
          photo,
          displayOrder: rangerOrder++,
        });
      }
    } else {
      const id = `rfr-rider-${kebab(name)}`;
      const { first, last } = splitName(name);
      let acc = riders.get(id);
      if (!acc) {
        acc = {
          id,
          firstName: first,
          lastName: last,
          country,
          bio,
          photo,
          displayOrder: riderOrder++,
          rallies: new Map(),
        };
        riders.set(id, acc);
      } else {
        if (!acc.bio && bio) acc.bio = bio;
        if (!acc.photo && photo) acc.photo = photo;
      }
      if (group) {
        const slug = `${countrySlug(group.country)}-${group.year}`;
        acc.rallies.set(slug, { year: group.year, slug });
      }
    }
  }
  return {
    riders: Array.from(riders.values()),
    rangers: Array.from(rangers.values()),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const printOnly = args.has('--print');
  const commit = args.has('--commit');

  const { riders, rangers } = accumulate();

  if (printOnly) {
    console.log(`\n📋 Offline preview: ${riders.length} riders, ${rangers.length} rangers\n`);
    console.log('Sample riders:');
    riders
      .slice(0, 5)
      .forEach(r =>
        console.log(
          `  ${r.id.padEnd(34)} ${r.firstName} ${r.lastName} | ${r.country} | rallies:[${Array.from(r.rallies.keys()).join(', ')}] | photo:${r.photo ? 'y' : 'n'}`
        )
      );
    console.log('Sample rangers:');
    rangers
      .slice(0, 5)
      .forEach(r =>
        console.log(
          `  ${r.id.padEnd(34)} ${r.name} | ${r.parkName} | ${r.country} | photo:${r.photo ? 'y' : 'n'}`
        )
      );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);
    console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

    // Map rally slug -> id for participant-rally links.
    const rallyRows = await prisma.rally.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, slug: true },
    });
    const rallyIdBySlug = new Map(rallyRows.map(r => [r.slug, r.id]));

    const [existingRiders, existingRangers] = await Promise.all([
      prisma.participant.count({ where: { tenantId: tenant.id } }),
      prisma.ranger.count({ where: { tenantId: tenant.id } }),
    ]);
    console.log(
      `ℹ️  Existing in DB — participants: ${existingRiders}, rangers: ${existingRangers}`
    );
    console.log(`📋 Plan — upsert ${riders.length} riders, ${rangers.length} rangers`);
    const linkable = riders.reduce(
      (n, r) => n + Array.from(r.rallies.keys()).filter(s => rallyIdBySlug.has(s)).length,
      0
    );
    console.log(
      `   ${linkable} rider↔rally links will be set (slugs matched to existing rallies)`
    );

    if (!commit) {
      console.log('\n🚫 Dry run — nothing written. Re-run with --commit to apply.');
      return;
    }

    let ridersDone = 0;
    let linksDone = 0;
    for (const r of riders) {
      await prisma.participant.upsert({
        where: { id: r.id },
        update: {
          firstName: r.firstName,
          lastName: r.lastName,
          country: r.country,
          bio: r.bio || null,
          photo: r.photo,
          displayOrder: r.displayOrder,
          isActive: true,
        },
        create: {
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          country: r.country,
          bio: r.bio || null,
          photo: r.photo,
          displayOrder: r.displayOrder,
          isActive: true,
          tenantId: tenant.id,
        },
      });
      for (const { slug, year } of r.rallies.values()) {
        const rallyId = rallyIdBySlug.get(slug);
        if (!rallyId) continue;
        await prisma.participantRally.upsert({
          where: { participantId_rallyId: { participantId: r.id, rallyId } },
          update: { year, role: 'Rider' },
          create: { participantId: r.id, rallyId, year, role: 'Rider' },
        });
        linksDone++;
      }
      ridersDone++;
    }

    let rangersDone = 0;
    for (const r of rangers) {
      await prisma.ranger.upsert({
        where: { id: r.id },
        update: {
          name: r.name,
          parkName: r.parkName,
          country: r.country,
          bio: r.bio || null,
          photo: r.photo,
          displayOrder: r.displayOrder,
          isActive: true,
        },
        create: {
          id: r.id,
          name: r.name,
          parkName: r.parkName,
          country: r.country,
          bio: r.bio || null,
          photo: r.photo,
          displayOrder: r.displayOrder,
          isActive: true,
          tenantId: tenant.id,
        },
      });
      rangersDone++;
    }

    console.log(
      `\n🎉 Done. Riders: ${ridersDone} (${linksDone} rally links), Rangers: ${rangersDone}.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
