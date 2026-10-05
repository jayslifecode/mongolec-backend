/**
 * Rally for Rangers — Team importer
 *
 * Two sources:
 *  1. `data/staff-bios.txt` — 7 active team members (Mongol Ecology Center field staff),
 *     alternating "Name<Role>" line then bio paragraph. Order in the file = displayOrder.
 *     Photos matched from the manifest `rfr/team/*` by first-name.
 *  2. `data/website-data-2026-09.json` ("Staff Members" sheet) — board/advisor rows not among
 *     the 7 above. Upserted with role "Board / Advisor", isActive=false (listed in the admin,
 *     not shown publicly). Garbage rows (no bio, no photo, no real name) are skipped. Photos
 *     re-uploaded from WordPress when available (see lib/reupload-wordpress.ts).
 *
 * Idempotent: upsert by (name, tenantId) — no deletes.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-team.ts --print   # offline preview
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-team.ts          # dry run
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-team.ts --commit # apply
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { buildBucketIndex, matchPortrait } from './lib/photo-match';
import { readManifest, writeManifest } from './lib/manifest';
import { reuploadWordpressPhoto } from './lib/reupload-wordpress';
import { isWordpressUrl, kebab, normaliseName } from './lib/text';

const TENANT_SLUG = 'rally-for-rangers';
const BIOS_FILE = path.join(__dirname, 'data', 'staff-bios.txt');
const SHEET_FILE = path.join(__dirname, 'data', 'website-data-2026-09.json');
const BOARD_ROLE = 'Board / Advisor';

export interface CoreMember {
  name: string;
  role: string;
  bio: string;
  photo: string | null;
  displayOrder: number;
  isActive: true;
}

export interface BoardMember {
  name: string;
  role: string;
  bio: string | null;
  photo: string | null;
  displayOrder: number;
  isActive: false;
}

type SheetRow = { Name: string; Role: string; 'Photo URL': string; Bio: string };

/** `staff-bios.txt` alternates a "Name<Role>" line (role has no leading space, title-case run)
 *  then a bio paragraph, repeated 7 times. Role starts at the first of a known set of title
 *  words; simplest robust split: role is the longest trailing run of capitalised words with no
 *  spaces before the next capital that isn't part of the name — but names here are always
 *  "First Last" or "First “Nick” Last", so split right after the last name token's letters. */
function splitNameRoleLine(line: string): { name: string; role: string } {
  // Roles observed: Executive Director, Co-Founder, Manager, Chef, Driver.
  const knownRoles = ['Executive Director', 'Co-Founder', 'Manager', 'Chef', 'Driver'];
  for (const role of knownRoles) {
    if (line.endsWith(role)) {
      return { name: line.slice(0, line.length - role.length).trim(), role };
    }
  }
  throw new Error(`Could not split name/role from line: "${line}"`);
}

export function parseStaffBios(raw: string): Array<{ name: string; role: string; bio: string }> {
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  const members: Array<{ name: string; role: string; bio: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const { name, role } = splitNameRoleLine(lines[i].trim());
    members.push({ name, role, bio: lines[i + 1].trim() });
  }
  return members;
}

function loadCoreMembers(manifest: ReturnType<typeof readManifest>): CoreMember[] {
  const raw = fs.readFileSync(BIOS_FILE, 'utf-8');
  const teamIndex = buildBucketIndex(manifest, 'team');
  return parseStaffBios(raw).map((m, i) => ({
    name: m.name,
    role: m.role,
    bio: m.bio,
    // Portraits are filed by first name only (BAdral.jpg, Wesley.jpg, ...).
    photo: matchPortrait(m.name.split(/\s+/)[0], teamIndex),
    displayOrder: i,
    isActive: true as const,
  }));
}

function isGarbageRow(row: SheetRow): boolean {
  const hasBio = !!(row.Bio || '').trim();
  const hasPhoto = !!(row['Photo URL'] || '').trim();
  const nameLooksReal = (row.Name || '').trim().split(/\s+/).length >= 2;
  return !hasBio && !hasPhoto && !nameLooksReal;
}

/** Strips a trailing ", Role" suffix some spreadsheet rows bake into the Name column. */
function cleanSheetName(name: string): string {
  return name.replace(/,\s*(Co-Founder|Executive Director|Manager|Chef|Driver).*$/i, '').trim();
}

async function loadBoardMembers(
  core: CoreMember[],
  manifest: ReturnType<typeof readManifest>
): Promise<BoardMember[]> {
  const sheets = JSON.parse(fs.readFileSync(SHEET_FILE, 'utf-8'));
  const rows: SheetRow[] = sheets['Staff Members'];
  const coreNames = new Set(core.map(m => normaliseName(m.name)));

  const candidates = rows
    .filter(r => !isGarbageRow(r))
    .map(r => ({ ...r, Name: cleanSheetName(r.Name) }))
    .filter(r => !coreNames.has(normaliseName(r.Name)));

  const members: BoardMember[] = [];
  for (const [i, row] of candidates.entries()) {
    const spreadsheetPhoto = (row['Photo URL'] || '').trim() || null;
    let photo = spreadsheetPhoto;
    if (spreadsheetPhoto && isWordpressUrl(spreadsheetPhoto)) {
      const reuploaded = await reuploadWordpressPhoto(
        spreadsheetPhoto,
        'team',
        kebab(row.Name),
        manifest
      );
      if (reuploaded) photo = reuploaded;
    }
    members.push({
      name: row.Name,
      role: BOARD_ROLE,
      bio: (row.Bio || '').trim() || null,
      photo,
      displayOrder: core.length + i,
      isActive: false,
    });
  }
  return members;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const printOnly = args.has('--print');
  const commit = args.has('--commit');

  if (printOnly) {
    const bios = parseStaffBios(fs.readFileSync(BIOS_FILE, 'utf-8'));
    console.log(`\n📋 ${bios.length} core team members (offline preview, no manifest/DB):\n`);
    bios.forEach((m, i) => console.log(`  ${i}. ${m.name.padEnd(28)} ${m.role}`));
    return;
  }

  const manifest = readManifest();
  const core = loadCoreMembers(manifest);
  const board = await loadBoardMembers(core, manifest);
  const all = [...core, ...board];

  console.log(
    `📋 Plan — ${core.length} active core members, ${board.length} inactive board/advisor members`
  );
  const missingPhotos = core.filter(m => !m.photo);
  if (missingPhotos.length) {
    console.log(
      `⚠️  Core members with no portrait match: ${missingPhotos.map(m => m.name).join(', ')}`
    );
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);
    console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

    const existing = await prisma.teamMember.findMany({
      where: { tenantId: tenant.id },
      select: { name: true },
    });
    console.log(`ℹ️  Existing team members: ${existing.map(e => e.name).join(', ') || '(none)'}`);

    if (!commit) {
      console.log('\n🚫 Dry run — nothing written. Re-run with --commit to apply.');
      return;
    }

    let created = 0;
    let updated = 0;
    for (const m of all) {
      const existingMember = await prisma.teamMember.findFirst({
        where: { tenantId: tenant.id, name: m.name },
      });
      const common = {
        role: m.role,
        bio: m.bio,
        photo: m.photo,
        displayOrder: m.displayOrder,
        isActive: m.isActive,
      };
      if (existingMember) {
        await prisma.teamMember.update({ where: { id: existingMember.id }, data: common });
        updated++;
      } else {
        await prisma.teamMember.create({ data: { ...common, name: m.name, tenantId: tenant.id } });
        created++;
      }
      console.log(`  ✅ ${existingMember ? 'updated' : 'created'} ${m.name} (${m.role})`);
    }

    writeManifest(manifest);
    console.log(`\n🎉 Done. Created ${created}, updated ${updated}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
