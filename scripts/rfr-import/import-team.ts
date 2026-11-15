/**
 * Rally for Rangers — Team importer
 *
 * Sources:
 *  1. `data/team-roster.json` — the public "Our Team" list (client order and titles, round-3
 *     feedback 2026-11-11). Array position = displayOrder; `photoKey` is an image-manifest key.
 *  2. `data/website-data-2026-09.json` ("Staff Members" sheet) — board/advisor rows not in the
 *     roster. Upserted with role "Board / Advisor", isActive=false (admin only, not public).
 *     Garbage rows (no bio, no photo, no real name) are skipped. Photos re-uploaded from
 *     WordPress when available (see lib/reupload-wordpress.ts).
 *
 * Every other team member of the tenant is set isActive=false so only the roster shows
 * publicly. Upsert by (name, tenantId) — no deletes.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-team.ts --print   # offline preview
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-team.ts          # dry run
 *   npx ts-node -r dotenv/config scripts/rfr-import/import-team.ts --commit # apply
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { readManifest, writeManifest } from './lib/manifest';
import { reuploadWordpressPhoto } from './lib/reupload-wordpress';
import { isWordpressUrl, kebab, normaliseName } from './lib/text';
import { loadRoster } from './lib/team-roster';

const TENANT_SLUG = 'rally-for-rangers';
const ROSTER_FILE = path.join(__dirname, 'data', 'team-roster.json');
const SHEET_FILE = path.join(__dirname, 'data', 'website-data-2026-09.json');
const BOARD_ROLE = 'Board / Advisor';

interface TeamRow {
  name: string;
  role: string;
  bio: string | null;
  photo: string | null;
  displayOrder: number;
  isActive: boolean;
}

type SheetRow = { Name: string; Role: string; 'Photo URL': string; Bio: string };
type Manifest = ReturnType<typeof readManifest>;

function loadCoreMembers(manifest: Manifest): TeamRow[] {
  return loadRoster(fs.readFileSync(ROSTER_FILE, 'utf-8')).map(m => ({
    name: m.name,
    role: m.role,
    bio: m.bio || null,
    photo: m.photoKey ? manifest[m.photoKey]?.url ?? null : null,
    displayOrder: m.displayOrder,
    isActive: true,
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

async function loadBoardMembers(core: TeamRow[], manifest: Manifest): Promise<TeamRow[]> {
  const sheets = JSON.parse(fs.readFileSync(SHEET_FILE, 'utf-8'));
  const rows: SheetRow[] = sheets['Staff Members'];
  const coreNames = new Set(core.map(m => normaliseName(m.name)));

  const candidates = rows
    .filter(r => !isGarbageRow(r))
    .map(r => ({ ...r, Name: cleanSheetName(r.Name) }))
    .filter(r => !coreNames.has(normaliseName(r.Name)));

  const members: TeamRow[] = [];
  for (const [i, row] of candidates.entries()) {
    const spreadsheetPhoto = (row['Photo URL'] || '').trim() || null;
    let photo = spreadsheetPhoto;
    if (spreadsheetPhoto && isWordpressUrl(spreadsheetPhoto)) {
      const reuploaded = await reuploadWordpressPhoto(spreadsheetPhoto, 'team', kebab(row.Name), manifest);
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

async function upsertMember(prisma: PrismaClient, tenantId: string, m: TeamRow): Promise<'created' | 'updated'> {
  const existing = await prisma.teamMember.findFirst({ where: { tenantId, name: m.name } });
  const data = { role: m.role, bio: m.bio, photo: m.photo, displayOrder: m.displayOrder, isActive: m.isActive };
  if (existing) {
    await prisma.teamMember.update({ where: { id: existing.id }, data });
    return 'updated';
  }
  await prisma.teamMember.create({ data: { ...data, name: m.name, tenantId } });
  return 'created';
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const commit = args.has('--commit');

  if (args.has('--print')) {
    const roster = loadRoster(fs.readFileSync(ROSTER_FILE, 'utf-8'));
    console.log(`\n📋 ${roster.length} public team members (offline preview):\n`);
    roster.forEach(m => console.log(`  ${m.displayOrder}. ${m.name.padEnd(34)} ${m.role}`));
    return;
  }

  const manifest = readManifest();
  const core = loadCoreMembers(manifest);
  const board = await loadBoardMembers(core, manifest);
  const publicNames = new Set(core.map(m => m.name));

  console.log(`📋 Plan — ${core.length} active roster members, ${board.length} inactive board/advisor rows`);
  core.forEach(m => console.log(`   ${m.displayOrder}. ${m.name.padEnd(34)} ${m.role}${m.photo ? '' : '  (no photo)'}${m.bio ? '' : '  (no bio)'}`));

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);
    console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

    const existing = await prisma.teamMember.findMany({
      where: { tenantId: tenant.id },
      select: { name: true, isActive: true },
    });
    const existingNames = new Set(existing.map(e => e.name));
    const toCreate = core.filter(m => !existingNames.has(m.name)).map(m => m.name);
    const toDeactivate = existing.filter(e => e.isActive && !publicNames.has(e.name)).map(e => e.name);
    console.log(`➕ New members: ${toCreate.join(', ') || '(none)'}`);
    console.log(`🙈 Will hide (isActive=false): ${toDeactivate.join(', ') || '(none)'}`);

    if (!commit) {
      console.log('\n🚫 Dry run — nothing written. Re-run with --commit to apply.');
      return;
    }

    for (const m of [...core, ...board]) {
      const outcome = await upsertMember(prisma, tenant.id, m);
      console.log(`  ✅ ${outcome} ${m.name} (${m.role})`);
    }
    const hidden = await prisma.teamMember.updateMany({
      where: { tenantId: tenant.id, isActive: true, name: { notIn: Array.from(publicNames) } },
      data: { isActive: false },
    });
    writeManifest(manifest);
    console.log(`\n🎉 Done. Roster ${core.length}, board ${board.length}, hidden ${hidden.count}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('❌ Import failed:', e);
  process.exit(1);
});
