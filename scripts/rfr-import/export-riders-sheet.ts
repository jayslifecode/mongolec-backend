/**
 * Rally for Rangers — export the master rider spreadsheet from the database.
 *
 * Columns: Last name | First name | Rallies (count) | Countries | one column per past rally
 * (by start date). The client marks attendance with "x" and sends it back; re-import with
 * `import-people.ts --from-sheet <file>`.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/export-riders-sheet.ts --out ~/Downloads/RFR_Riders_Master.xlsx
 */
import { PrismaClient } from '@prisma/client';
import * as os from 'os';
import * as path from 'path';
import { toSheetRows, type SheetRider } from './lib/rider-sheet';
import { writeRiderSheet, type KeyedRally } from './lib/rider-sheet-file';

const TENANT_SLUG = 'rally-for-rangers';
const DEFAULT_OUT = path.join(os.homedir(), 'Downloads', 'RFR_Riders_Master.xlsx');

function outPathFromArgs(argv: string[]): string {
  const i = argv.indexOf('--out');
  const raw = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && !raw) throw new Error('--out needs a file path');
  return raw ? path.resolve(raw.replace(/^~(?=\/)/, os.homedir())) : DEFAULT_OUT;
}

function titleOf(title: unknown, fallback: string): string {
  const en = (title as { en?: unknown } | null)?.en;
  return typeof en === 'string' && en.trim() ? en.trim() : fallback;
}

async function main() {
  const outPath = outPathFromArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);

    const rallyRows = await prisma.rally.findMany({
      where: { tenantId: tenant.id, startDate: { lte: new Date() } },
      orderBy: { startDate: 'asc' },
      select: { slug: true, title: true, startDate: true },
    });
    const rallies: KeyedRally[] = rallyRows.map(r => ({
      slug: r.slug,
      title: titleOf(r.title, r.slug),
      startDate: r.startDate,
    }));

    const participants = await prisma.participant.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { firstName: true, lastName: true, rallies: { select: { rally: { select: { slug: true } } } } },
    });
    const riders: SheetRider[] = participants.map(p => ({
      firstName: p.firstName,
      lastName: p.lastName,
      rallySlugs: p.rallies.map(link => link.rally.slug),
    }));

    const rows = toSheetRows(riders, rallies);
    await writeRiderSheet(outPath, rows, rallies);

    console.log(`✅ Wrote ${riders.length} riders × ${rallies.length} rallies → ${outPath}`);
    rallies.forEach(r => {
      const count = riders.filter(rider => rider.rallySlugs.includes(r.slug)).length;
      console.log(`   ${r.title.padEnd(16)} ${count}`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('❌ Export failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
