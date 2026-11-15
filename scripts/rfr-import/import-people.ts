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
 * Rangers never become riders: portrait sightings of anyone typed "Ranger" in the sheet or
 * present in Ranger_Portraits are dropped, as are unnamed camera files (FRF01826.jpg).
 *
 * Master sheet mode (`--from-sheet`): RFR_Riders_Master.xlsx (see export-riders-sheet.ts) is the
 * only source of riders and rally links; bio/photo/country are kept from the existing rows.
 * Rangers are not touched in this mode.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts --print   # offline mapping preview, no DB
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts          # dry run — plan only, no writes
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts --commit # apply
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts --from-sheet ~/Downloads/RFR_Riders_Master.xlsx [--commit]
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
import {
  mergeRiderSightings,
  riderMergeKey,
  splitRiderName,
  type MergedRider,
  type RiderSighting,
} from './lib/rider-merge';
import { nameFromFilename, scanPortraitFolders } from './lib/portrait-folders';
import { parseGroupHeader, type GroupHeader } from './lib/sheet-groups';
import { fromSheetRows, mergeSheetRiders } from './lib/rider-sheet';
import { readRiderSheet } from './lib/rider-sheet-file';

const TENANT_SLUG = 'rally-for-rangers';
const DATA_FILE = path.join(__dirname, 'data', 'website-data-2026-09.json');
const DRIVE_EXPORT_DIR = path.join(os.homedir(), 'Downloads', 'Website');
const PORTRAITS_DIR =
  process.env.RFR_PORTRAITS_DIR || path.join(DRIVE_EXPORT_DIR, 'Rider_Portraits');
const RANGER_PORTRAITS_DIR =
  process.env.RFR_RANGER_PORTRAITS_DIR || path.join(DRIVE_EXPORT_DIR, 'Ranger_Portraits');
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
  let group: GroupHeader | null = null;
  let rangerOrder = 0;

  for (const r of rows) {
    if (isHeader(r)) {
      group = parseGroupHeader(r['#']);
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
      rallySlug: group?.rallySlug ?? null,
      year: group?.rallySlug ? group.year : null,
      role: 'Rider',
    });
  }
  return { riderSightings, rangers: Array.from(rangers.values()) };
}

function loadRows(): Row[] {
  const sheets = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  return sheets['Riders by Rally'];
}

/**
 * Merge keys of people who are rangers: sheet rows typed "Ranger" plus every file in the
 * Ranger_Portraits folder. Anyone the sheet lists as a rider is never excluded (a rider's
 * portrait occasionally sits in the ranger folder, e.g. Jake Szympruch).
 */
function rangerExcludeKeys(rows: Row[]): Set<string> {
  const riderKeys = new Set(
    rows.filter(r => r.Name && /rider/i.test(r.Type || '')).map(r => riderMergeKey(r.Name))
  );
  const rangerNames = rows.filter(r => r.Name && /ranger/i.test(r.Type || '')).map(r => r.Name);
  const rangerFiles = fs.existsSync(RANGER_PORTRAITS_DIR)
    ? fs.readdirSync(RANGER_PORTRAITS_DIR).map(nameFromFilename)
    : [];
  return new Set(
    [...rangerNames, ...rangerFiles].map(riderMergeKey).filter(k => k && !riderKeys.has(k))
  );
}

/** Portrait folders -> RiderSighting[] (no bio; adds/confirms rally links, no photo URL — the
 * manifest, not the folder file, is the source of the actual portrait). */
function portraitSightings(excludeKeys: Set<string>): RiderSighting[] {
  return scanPortraitFolders(PORTRAITS_DIR, { excludeKeys }).map(p => ({
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

/** First/last name for the DB row: explicit (master sheet) or derived from the display name. */
function nameParts(r: ResolvedRider): { firstName: string; lastName: string } {
  if (r.firstName !== undefined) return { firstName: r.firstName, lastName: r.lastName ?? '' };
  return splitRiderName(r.displayName);
}

async function loadTenantContext(
  prisma: PrismaClient
): Promise<{ tenantId: string; rallyIdBySlug: Map<string, string> }> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);
  console.log(`\n✅ Tenant: ${tenant.name} (${tenant.id})`);
  const rallyRows = await prisma.rally.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, slug: true },
  });
  return { tenantId: tenant.id, rallyIdBySlug: new Map(rallyRows.map(r => [r.slug, r.id])) };
}

/**
 * Print the plan (stale riders to delete, upserts, links) and, with `commit`, apply it:
 * delete stale `rfr-rider-*` participants, upsert every rider, replace each rider's links.
 * Returns true when it wrote.
 */
async function writeRiders(
  prisma: PrismaClient,
  tenantId: string,
  rallyIdBySlug: Map<string, string>,
  riders: ResolvedRider[],
  commit: boolean
): Promise<boolean> {
  const existing = await prisma.participant.findMany({
    where: { tenantId, id: { startsWith: 'rfr-rider-' } },
    select: { id: true, firstName: true, lastName: true },
  });
  const producedIds = new Set(riders.map(r => r.id));
  const toDelete = existing.filter(p => !producedIds.has(p.id));
  const linkable = riders.reduce(
    (n, r) => n + Array.from(r.rallies.keys()).filter(s => rallyIdBySlug.has(s)).length,
    0
  );
  const unknownSlugs = Array.from(
    new Set(riders.flatMap(r => Array.from(r.rallies.keys())).filter(s => !rallyIdBySlug.has(s)))
  );

  console.log(`📋 Plan — upsert ${riders.length} riders (${linkable} rally links)`);
  if (unknownSlugs.length) {
    console.log(`⚠️  Rally slugs with no rally row (links skipped): ${unknownSlugs.join(', ')}`);
  }
  if (toDelete.length) {
    console.log(`🗑️  Will delete ${toDelete.length} stale rfr-rider-* participants:`);
    toDelete.forEach(p => console.log(`   - ${p.id} (${p.firstName} ${p.lastName})`));
  }
  if (!commit) {
    console.log('\n🚫 Dry run — nothing written. Re-run with --commit to apply.');
    return false;
  }

  if (toDelete.length) {
    const ids = toDelete.map(p => p.id);
    await prisma.participantRally.deleteMany({ where: { participantId: { in: ids } } });
    await prisma.participant.deleteMany({ where: { id: { in: ids } } });
  }

  let linksDone = 0;
  for (const [index, r] of riders.entries()) {
    const fields = {
      ...nameParts(r),
      slug: r.slug,
      country: r.country,
      bio: r.bio || null,
      photo: r.photo,
      isActive: true,
    };
    await prisma.participant.upsert({
      where: { id: r.id },
      update: fields,
      create: { ...fields, id: r.id, displayOrder: index, tenantId },
    });
    // Replace this rider's links to match the freshly computed set exactly.
    await prisma.participantRally.deleteMany({ where: { participantId: r.id } });
    for (const [slug, { year, role }] of r.rallies.entries()) {
      const rallyId = rallyIdBySlug.get(slug);
      if (!rallyId) continue;
      await prisma.participantRally.create({
        data: { participantId: r.id, rallyId, year, role: role ?? 'Rider' },
      });
      linksDone++;
    }
  }
  console.log(
    `\n🎉 Riders: ${riders.length} (${linksDone} rally links). Deleted stale: ${toDelete.length}.`
  );
  return true;
}

async function writeRangers(prisma: PrismaClient, tenantId: string, rangers: RangerAcc[]) {
  for (const r of rangers) {
    const fields = {
      name: r.name,
      parkName: r.parkName || FALLBACK_PARK_NAME,
      country: r.country,
      bio: r.bio || null,
      photo: r.photo,
      displayOrder: r.displayOrder,
      isActive: true,
    };
    await prisma.ranger.upsert({
      where: { id: r.id },
      update: fields,
      create: { ...fields, id: r.id, tenantId },
    });
  }
  console.log(`🎉 Rangers: ${rangers.length}.`);
}

async function printFinalCounts(
  prisma: PrismaClient,
  tenantId: string,
  rallyIdBySlug: Map<string, string>
) {
  const [totalRiders, ridersWithPhoto, linksTotal] = await Promise.all([
    prisma.participant.count({ where: { tenantId } }),
    prisma.participant.count({ where: { tenantId, photo: { not: null } } }),
    prisma.participantRally.count({ where: { participant: { tenantId } } }),
  ]);
  console.log(
    `\n📈 Final counts — total riders: ${totalRiders}, with photo: ${ridersWithPhoto}, links: ${linksTotal}`
  );
  console.log('\n📍 Riders per rally slug:');
  const perRally = await Promise.all(
    Array.from(rallyIdBySlug.entries()).map(async ([slug, rallyId]) => ({
      slug,
      count: await prisma.participantRally.count({ where: { rallyId } }),
    }))
  );
  perRally
    .filter(r => r.count > 0)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach(r => console.log(`   ${r.slug.padEnd(22)} ${r.count}`));
}

/** `--from-sheet <xlsx>`: the master sheet alone decides riders and their rally links. */
async function runFromSheet(sheetPath: string, commit: boolean) {
  const { rows, rallyKey } = await readRiderSheet(sheetPath);
  const sheetRiders = fromSheetRows(rows, rallyKey);
  const prisma = new PrismaClient();
  try {
    const { tenantId, rallyIdBySlug } = await loadTenantContext(prisma);
    const existing = await prisma.participant.findMany({
      where: { tenantId },
      select: { firstName: true, lastName: true, bio: true, photo: true, country: true },
    });
    const riderIndex = buildBucketIndex(readManifest(), 'riders');
    const riders = assignIdsAndSlugs(mergeSheetRiders(sheetRiders, existing, DEFAULT_COUNTRY)).map(
      r => ({ ...r, photo: r.photo ?? matchPortrait(r.displayName, riderIndex) ?? null })
    );

    console.log(`\n📄 ${sheetPath}: ${riders.length} riders`);
    printSummary(riders);
    if (await writeRiders(prisma, tenantId, rallyIdBySlug, riders, commit)) {
      await printFinalCounts(prisma, tenantId, rallyIdBySlug);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Default mode: "Riders by Rally" sheet + portrait folders + rangers. */
async function runFromSources(printOnly: boolean, commit: boolean) {
  const rows = loadRows();
  const { riderSightings, rangers } = accumulate(rows);
  const allSightings = [...riderSightings, ...portraitSightings(rangerExcludeKeys(rows))];
  const riders = assignIdsAndSlugs(mergeRiderSightings(allSightings, DEFAULT_COUNTRY));
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
    console.log(`\n⚠️  ${unmatched.length} people with no portrait match and no spreadsheet photo:`);
    unmatched.forEach(n => console.log(`   - ${n}`));
  }
  console.log(
    `\n👥 ${riders.length} unique riders (merged ${duplicatesMerged} duplicate sightings), ${rangers.length} rangers`
  );
  printSummary(riders);

  const prisma = new PrismaClient();
  try {
    const { tenantId, rallyIdBySlug } = await loadTenantContext(prisma);
    console.log(`📋 Plan — upsert ${resolvedRangers.length} rangers`);
    if (!(await writeRiders(prisma, tenantId, rallyIdBySlug, resolvedRiders, commit))) return;
    await writeRangers(prisma, tenantId, resolvedRangers);
    writeManifest(manifest);
    await printFinalCounts(prisma, tenantId, rallyIdBySlug);
  } finally {
    await prisma.$disconnect();
  }
}

function sheetPathFromArgs(argv: string[]): string | null {
  const i = argv.indexOf('--from-sheet');
  if (i < 0) return null;
  const raw = argv[i + 1];
  if (!raw || raw.startsWith('--')) throw new Error('--from-sheet needs an .xlsx path');
  return path.resolve(raw.replace(/^~(?=\/)/, os.homedir()));
}

async function main() {
  const argv = process.argv.slice(2);
  const commit = argv.includes('--commit');
  const sheetPath = sheetPathFromArgs(argv);
  if (sheetPath) return runFromSheet(sheetPath, commit);
  return runFromSources(argv.includes('--print'), commit);
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
