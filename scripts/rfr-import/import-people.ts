/**
 * Rally for Rangers — Riders & Rangers importer
 *
 * Source: scripts/rfr-import/data/website-data-2026-09.json ("Riders by Rally" sheet — the
 * fresh 2026-09-22 spreadsheet dump). Rows are grouped by a header like
 * "2014  —  Lake Hovsgol National Park - Mongolia  (12 riders)"; each person row has Name,
 * Type (Rider|Ranger), Photo URL, Bio.
 *
 * - Riders   -> Participant (+ ParticipantRally links so `rallyYears` populates on the site)
 * - Rangers  -> Ranger
 *
 * Photos: matched from scripts/rfr-import/data/image-manifest.json by normalised name. If no
 * manifest portrait exists, falls back to the spreadsheet Photo URL — unless that URL points
 * at the old WordPress host, in which case it is downloaded and re-uploaded into B2 so no
 * WordPress hotlinks remain live (see lib/reupload-wordpress.ts).
 *
 * Idempotent: records use deterministic IDs (rfr-rider-<slug> / rfr-ranger-<slug>) so re-runs
 * update in place. No deletes.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts --print   # offline mapping preview, no DB
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts          # dry run — plan only, no writes
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts --commit # apply
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { mapWithConcurrency } from './lib/concurrency';
import { buildBucketIndex, matchPortrait } from './lib/photo-match';
import { readManifest, writeManifest } from './lib/manifest';
import { reuploadWordpressPhoto } from './lib/reupload-wordpress';
import { isWordpressUrl, kebab } from './lib/text';

const TENANT_SLUG = 'rally-for-rangers';
const DATA_FILE = path.join(__dirname, 'data', 'website-data-2026-09.json');
const FALLBACK_PARK_NAME = 'Protected area ranger';

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

function accumulate(rows: Row[]) {
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
          parkName: group?.park || FALLBACK_PARK_NAME,
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
        const slug = `${kebab(group.country)}-${group.year}`;
        acc.rallies.set(slug, { year: group.year, slug });
      }
    }
  }
  return {
    riders: Array.from(riders.values()),
    rangers: Array.from(rangers.values()),
  };
}

function loadRows(): Row[] {
  const sheets = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  return sheets['Riders by Rally'];
}

/**
 * Resolves the best photo URL for a person: manifest portrait match first, then (if the
 * spreadsheet URL is a WordPress hotlink) a re-upload into B2, then the raw spreadsheet URL.
 */
async function resolvePhoto(
  name: string,
  spreadsheetPhoto: string | null,
  bucket: 'riders' | 'rangers',
  index: Map<string, string>,
  manifest: ReturnType<typeof readManifest>,
  unmatched: string[]
): Promise<string | null> {
  const manifestMatch = matchPortrait(name, index);
  if (manifestMatch) return manifestMatch;

  if (spreadsheetPhoto && isWordpressUrl(spreadsheetPhoto)) {
    const reuploaded = await reuploadWordpressPhoto(
      spreadsheetPhoto,
      bucket,
      kebab(name),
      manifest
    );
    if (reuploaded) return reuploaded;
    // The WordPress file is gone (404) or unreachable: never persist a dead hotlink.
    unmatched.push(name);
    return null;
  }
  if (!spreadsheetPhoto) unmatched.push(name);
  return spreadsheetPhoto;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const printOnly = args.has('--print');
  const commit = args.has('--commit');

  const { riders, rangers } = accumulate(loadRows());

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

  const manifest = readManifest();
  const riderIndex = buildBucketIndex(manifest, 'riders');
  const rangerIndex = buildBucketIndex(manifest, 'rangers');
  const unmatched: string[] = [];

  // Bounded concurrency: the only slow path is downloading WordPress fallback photos from a
  // single (slow) host, so a handful of parallel requests at a time keeps this predictable
  // instead of queuing 200+ fetches against one origin at once.
  const resolvedRiders = await mapWithConcurrency(riders, 4, async r => ({
    ...r,
    photo: await resolvePhoto(
      `${r.firstName} ${r.lastName}`,
      r.photo,
      'riders',
      riderIndex,
      manifest,
      unmatched
    ),
  }));
  const resolvedRangers = await mapWithConcurrency(rangers, 4, async r => ({
    ...r,
    photo: await resolvePhoto(r.name, r.photo, 'rangers', rangerIndex, manifest, unmatched),
  }));

  if (unmatched.length) {
    console.log(
      `\n⚠️  ${unmatched.length} people with no portrait match and no spreadsheet photo:`
    );
    unmatched.forEach(n => console.log(`   - ${n}`));
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

    const [existingRiders, existingRangers] = await Promise.all([
      prisma.participant.count({ where: { tenantId: tenant.id } }),
      prisma.ranger.count({ where: { tenantId: tenant.id } }),
    ]);
    console.log(
      `ℹ️  Existing in DB — participants: ${existingRiders}, rangers: ${existingRangers}`
    );
    console.log(
      `📋 Plan — upsert ${resolvedRiders.length} riders, ${resolvedRangers.length} rangers`
    );
    const linkable = resolvedRiders.reduce(
      (n, r) => n + Array.from(r.rallies.keys()).filter(s => rallyIdBySlug.has(s)).length,
      0
    );
    console.log(`   ${linkable} rider↔rally links will be set (slugs matched to existing rallies)`);

    if (!commit) {
      console.log('\n🚫 Dry run — nothing written. Re-run with --commit to apply.');
      return;
    }

    let ridersDone = 0;
    let linksDone = 0;
    for (const r of resolvedRiders) {
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
    for (const r of resolvedRangers) {
      await prisma.ranger.upsert({
        where: { id: r.id },
        update: {
          name: r.name,
          parkName: r.parkName || FALLBACK_PARK_NAME,
          country: r.country,
          bio: r.bio || null,
          photo: r.photo,
          displayOrder: r.displayOrder,
          isActive: true,
        },
        create: {
          id: r.id,
          name: r.name,
          parkName: r.parkName || FALLBACK_PARK_NAME,
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

    writeManifest(manifest);
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
