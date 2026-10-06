/**
 * Rally for Rangers — Riders & Rangers importer
 *
 * Sources:
 *  - scripts/rfr-import/data/website-data-2026-09.json ("Riders by Rally" sheet). Rows are
 *    grouped by a header like "2014  —  Lake Hovsgol National Park - Mongolia  (12 riders)";
 *    each person row has Name, Type (Rider|Ranger), Photo URL, Bio. The same rider appears
 *    once per rally they attended, suffixed " - YYYY" ("Wesley Thornberry - 2022").
 *  - Rider_Portraits/<Year>_<Country>[_<Park>]/<First_Last>.<ext> Drive folders (18 rally
 *    folders + "New Folder"). The uploader deduplicated portraits by name, so folder
 *    membership — not the manifest — is how we re-derive which rallies a rider attended when
 *    the sheet doesn't say (e.g. bhutan-2022, peru-2022, namibia-2023, mongolia-2019,
 *    mongolia-2023, bhutan-2024). "New Folder" adds portraits/people with no rally link.
 *
 * Riders  -> Participant (+ ParticipantRally links so `rallyCount`/`tier`/`rallies` work)
 * Rangers -> Ranger (unchanged from the previous importer)
 *
 * Merging: names are normalised (strip " - YYYY", collapse whitespace, case-fold for the
 * merge key); every sighting of the same person folds into one Participant — longest bio
 * wins (its casing becomes the display name), photo = manifest portrait match else a
 * re-uploaded WordPress photo (never a dead hotlink). Participant id is deterministic
 * (`rfr-rider-<slug>`), so a merge can change a rider's id across runs — the importer deletes
 * `rfr-rider-*` participants (and their links) that are no longer produced, and logs what it
 * deletes, before upserting the current set.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts --print   # offline mapping preview, no DB
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts          # dry run — plan only, no writes
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts --commit # apply
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mapWithConcurrency } from './lib/concurrency';
import { buildBucketIndex, matchPortrait } from './lib/photo-match';
import { readManifest, writeManifest } from './lib/manifest';
import { reuploadWordpressPhoto } from './lib/reupload-wordpress';
import { isWordpressUrl, kebab } from './lib/text';
import { mergeRiderSightings, type MergedRider, type RiderSighting } from './lib/rider-merge';
import { scanPortraitFolders } from './lib/portrait-folders';

const TENANT_SLUG = 'rally-for-rangers';
const DATA_FILE = path.join(__dirname, 'data', 'website-data-2026-09.json');
const PORTRAITS_DIR =
  process.env.RFR_PORTRAITS_DIR ||
  path.join(os.homedir(), 'Downloads', 'Website 2', 'Rider_Portraits');
const FALLBACK_PARK_NAME = 'Protected area ranger';
const DEFAULT_COUNTRY = 'Mongolia';

type Row = {
  '#': string;
  Name: string;
  Type: string;
  'Photo URL': string;
  Bio: string;
  'Position / Notes': string;
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

type ResolvedRider = MergedRider & { id: string; slug: string; photo: string | null };

/** Parse a group header: "2014  —  Lake Hovsgol National Park - Mongolia  (12 riders)". */
function parseHeader(s: string): { year: number; park: string; country: string } | null {
  const m = s.match(/^\s*(\d{4})\s*[—-]+\s*(.+?)\s*-\s*([^()]+?)\s*\(/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), park: m[2].trim(), country: m[3].trim() };
}

function cleanPhoto(url: string): string | null {
  const u = (url || '').trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

function isHeader(r: Row): boolean {
  return !!r['#'] && !r.Name && !r.Type;
}

/** Riders -> RiderSighting[]; Rangers -> RangerAcc[] (unchanged merge-by-exact-name). */
function accumulate(rows: Row[]): { riderSightings: RiderSighting[]; rangers: RangerAcc[] } {
  const riderSightings: RiderSighting[] = [];
  const rangers = new Map<string, RangerAcc>();
  let group: { year: number; park: string; country: string } | null = null;
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
    const country = group?.country || DEFAULT_COUNTRY;

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
      continue;
    }

    riderSightings.push({
      rawName: name,
      bio,
      photo,
      country,
      rallySlug: group ? `${kebab(group.country)}-${group.year}` : null,
      year: group?.year ?? null,
      role: 'Rider',
    });
  }
  return { riderSightings, rangers: Array.from(rangers.values()) };
}

function loadRows(): Row[] {
  const sheets = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  return sheets['Riders by Rally'];
}

/** Portrait folders -> RiderSighting[] (no bio; adds/confirms rally links, no photo URL — the
 * manifest, not the folder file, is the source of the actual portrait). */
function portraitSightings(): RiderSighting[] {
  return scanPortraitFolders(PORTRAITS_DIR).map(p => ({
    rawName: p.name,
    country: p.country ?? undefined,
    rallySlug: p.rallySlug,
    year: p.year,
    role: 'Rider',
  }));
}

/** Resolves the best photo URL: manifest portrait match first, then a WordPress re-upload. */
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
    unmatched.push(name); // dead WordPress link: never persist it
    return null;
  }
  if (!spreadsheetPhoto) unmatched.push(name);
  return spreadsheetPhoto;
}

/** Deterministic `rfr-rider-<slug>` id, de-duplicated against same-named different people. */
function assignIdsAndSlugs(riders: MergedRider[]): ResolvedRider[] {
  const used = new Set<string>();
  return riders.map(r => {
    const base = kebab(r.displayName) || 'rider';
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);
    return { ...r, id: `rfr-rider-${slug}`, slug, photo: r.photo };
  });
}

function printSummary(riders: ResolvedRider[]) {
  const perRally = new Map<string, number>();
  for (const r of riders) {
    for (const slug of r.rallies.keys()) {
      perRally.set(slug, (perRally.get(slug) ?? 0) + 1);
    }
  }
  const multiRally = riders
    .filter(r => r.rallies.size >= 2)
    .sort((a, b) => b.rallies.size - a.rallies.size);

  console.log(`\n📊 Riders per rally (${perRally.size} rallies):`);
  Array.from(perRally.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([slug, count]) => console.log(`   ${slug.padEnd(22)} ${count}`));

  console.log(`\n🏆 Riders with ≥2 rallies (${multiRally.length}):`);
  multiRally
    .slice(0, 15)
    .forEach(r => console.log(`   ${r.displayName.padEnd(28)} ${r.rallies.size} rallies`));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const printOnly = args.has('--print');
  const commit = args.has('--commit');

  const { riderSightings, rangers } = accumulate(loadRows());
  const allSightings = [...riderSightings, ...portraitSightings()];
  const mergedRiders = mergeRiderSightings(allSightings, DEFAULT_COUNTRY);
  const riders = assignIdsAndSlugs(mergedRiders);

  const duplicatesMerged = allSightings.length - riders.length;

  if (printOnly) {
    console.log(
      `\n📋 Offline preview: ${riders.length} unique riders (${duplicatesMerged} sightings merged away), ${rangers.length} rangers\n`
    );
    riders
      .slice(0, 5)
      .forEach(r =>
        console.log(
          `  ${r.id.padEnd(34)} ${r.displayName} | ${r.country} | rallies:[${Array.from(r.rallies.keys()).join(', ')}]`
        )
      );
    printSummary(riders);
    return;
  }

  const manifest = readManifest();
  const riderIndex = buildBucketIndex(manifest, 'riders');
  const rangerIndex = buildBucketIndex(manifest, 'rangers');
  const unmatched: string[] = [];

  const resolvedRiders = await mapWithConcurrency(riders, 4, async r => ({
    ...r,
    photo: await resolvePhoto(r.displayName, r.photo, 'riders', riderIndex, manifest, unmatched),
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

  console.log(
    `\n👥 ${riders.length} unique riders (merged ${duplicatesMerged} duplicate sightings), ${rangers.length} rangers`
  );
  printSummary(riders);

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);
    console.log(`\n✅ Tenant: ${tenant.name} (${tenant.id})`);

    const rallyRows = await prisma.rally.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, slug: true },
    });
    const rallyIdBySlug = new Map(rallyRows.map(r => [r.slug, r.id]));

    const existingRiderIds = (
      await prisma.participant.findMany({
        where: { tenantId: tenant.id, id: { startsWith: 'rfr-rider-' } },
        select: { id: true, firstName: true, lastName: true },
      })
    ).map(p => p);
    const producedIds = new Set(resolvedRiders.map(r => r.id));
    const toDelete = existingRiderIds.filter(p => !producedIds.has(p.id));

    const linkable = resolvedRiders.reduce(
      (n, r) => n + Array.from(r.rallies.keys()).filter(s => rallyIdBySlug.has(s)).length,
      0
    );
    console.log(
      `📋 Plan — upsert ${resolvedRiders.length} riders (${linkable} rally links), ${resolvedRangers.length} rangers`
    );
    if (toDelete.length) {
      console.log(
        `🗑️  Will delete ${toDelete.length} stale rfr-rider-* participants (merged away by renormalisation):`
      );
      toDelete.forEach(p => console.log(`   - ${p.id} (${p.firstName} ${p.lastName})`));
    }

    if (!commit) {
      console.log('\n🚫 Dry run — nothing written. Re-run with --commit to apply.');
      return;
    }

    if (toDelete.length) {
      await prisma.participantRally.deleteMany({
        where: { participantId: { in: toDelete.map(p => p.id) } },
      });
      await prisma.participant.deleteMany({ where: { id: { in: toDelete.map(p => p.id) } } });
    }

    let ridersDone = 0;
    let linksDone = 0;
    for (const r of resolvedRiders) {
      const [first, ...rest] = r.displayName.split(' ');
      await prisma.participant.upsert({
        where: { id: r.id },
        update: {
          firstName: first,
          lastName: rest.join(' '),
          slug: r.slug,
          country: r.country,
          bio: r.bio || null,
          photo: r.photo,
          isActive: true,
        },
        create: {
          id: r.id,
          firstName: first,
          lastName: rest.join(' '),
          slug: r.slug,
          country: r.country,
          bio: r.bio || null,
          photo: r.photo,
          displayOrder: ridersDone,
          isActive: true,
          tenantId: tenant.id,
        },
      });
      // Replace this rider's links atomically to match the freshly computed set exactly.
      await prisma.participantRally.deleteMany({ where: { participantId: r.id } });
      for (const [slug, { year, role }] of r.rallies.entries()) {
        const rallyId = rallyIdBySlug.get(slug);
        if (!rallyId) continue;
        await prisma.participantRally.create({
          data: { participantId: r.id, rallyId, year, role: role ?? 'Rider' },
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

    const [totalRiders, ridersWithPhoto, linksTotal] = await Promise.all([
      prisma.participant.count({ where: { tenantId: tenant.id } }),
      prisma.participant.count({ where: { tenantId: tenant.id, photo: { not: null } } }),
      prisma.participantRally.count({
        where: { participant: { tenantId: tenant.id } },
      }),
    ]);
    const topRiders = await prisma.participant.findMany({
      where: { tenantId: tenant.id },
      include: { _count: { select: { rallies: true } } },
      orderBy: { rallies: { _count: 'desc' } },
      take: 10,
    });
    const ridersPerRallySlug = await Promise.all(
      Array.from(rallyIdBySlug.entries()).map(async ([slug, rallyId]) => [
        slug,
        await prisma.participantRally.count({ where: { rallyId } }),
      ])
    );

    console.log(
      `\n🎉 Done. Riders: ${ridersDone} (${linksDone} rally links), Rangers: ${rangersDone}. Deleted stale: ${toDelete.length}.`
    );
    console.log(
      `\n📈 Final counts — total riders: ${totalRiders}, with photo: ${ridersWithPhoto}, links: ${linksTotal}`
    );
    console.log('\n🥇 Top 10 riders by rally count:');
    topRiders.forEach(r =>
      console.log(`   ${(r.firstName + ' ' + r.lastName).padEnd(28)} ${r._count.rallies}`)
    );
    console.log('\n📍 Riders per rally slug:');
    ridersPerRallySlug
      .filter(([, count]) => (count as number) > 0)
      .sort(([a], [b]) => (a as string).localeCompare(b as string))
      .forEach(([slug, count]) => console.log(`   ${(slug as string).padEnd(22)} ${count}`));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
