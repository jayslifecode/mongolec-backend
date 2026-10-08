/**
 * Merch — apply percentage discounts from the client's price sheet.
 *
 * Source: scripts/merch-import/data/discounts-<date>.json (sku -> percent). One MerchDiscount is
 * created per (tenant, percent) — e.g. "Price list 2026-10-06 — 30% off" — and the matching
 * products are connected to it. Products are matched by SKU across all tenants.
 *
 * Idempotent: discounts are keyed by name within a tenant; re-runs update dates/value and
 * replace the product links. No deletes. Discounts that disappear from the sheet are not
 * touched (deactivate them in the admin).
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/merch-import/apply-discounts.ts            # dry run
 *   npx ts-node -r dotenv/config scripts/merch-import/apply-discounts.ts --commit   # write
 *   DISCOUNTS_FILE=... to point at another sheet export.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface DiscountItem {
  sku: string;
  percent: number;
  label?: string;
}
interface DiscountFile {
  startDate: string;
  endDate: string;
  items: DiscountItem[];
}
interface PlannedDiscount {
  tenantId: string;
  name: string;
  percent: number;
  productIds: string[];
  skus: string[];
}

const DEFAULT_FILE = path.join(__dirname, 'data', 'discounts-2026-10-06.json');
const COMMIT = process.argv.includes('--commit');

function readDiscountFile(filePath: string): DiscountFile {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as DiscountFile;
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error(`No items in ${filePath}`);
  }
  for (const item of raw.items) {
    if (!item.sku || !(item.percent > 0 && item.percent < 100)) {
      throw new Error(`Invalid item ${JSON.stringify(item)} (percent must be 0-100 exclusive)`);
    }
  }
  return raw;
}

/** Groups matched products into one discount per (tenant, percent). Pure. */
export function planDiscounts(
  items: DiscountItem[],
  products: Array<{ id: string; sku: string | null; tenantId: string }>,
  sheetDate: string
): { planned: PlannedDiscount[]; unmatched: string[] } {
  const bySku = new Map(products.filter(p => p.sku).map(p => [p.sku as string, p]));
  const groups = new Map<string, PlannedDiscount>();
  const unmatched: string[] = [];
  for (const item of items) {
    const product = bySku.get(item.sku);
    if (!product) {
      unmatched.push(item.sku);
      continue;
    }
    const key = `${product.tenantId}|${item.percent}`;
    const existing = groups.get(key);
    const next: PlannedDiscount = existing
      ? {
          ...existing,
          productIds: [...existing.productIds, product.id],
          skus: [...existing.skus, item.sku],
        }
      : {
          tenantId: product.tenantId,
          name: `Price list ${sheetDate} — ${item.percent}% off`,
          percent: item.percent,
          productIds: [product.id],
          skus: [item.sku],
        };
    groups.set(key, next);
  }
  return { planned: Array.from(groups.values()), unmatched };
}

async function main(): Promise<void> {
  const filePath = process.env.DISCOUNTS_FILE ?? DEFAULT_FILE;
  const file = readDiscountFile(filePath);
  const prisma = new PrismaClient();
  try {
    const products = await prisma.merchProduct.findMany({
      where: { deletedAt: null },
      select: { id: true, sku: true, tenantId: true, price: true },
    });
    const { planned, unmatched } = planDiscounts(file.items, products, file.startDate);

    console.log(
      `📋 ${file.items.length} sheet rows → ${planned.length} discount(s) across tenants`
    );
    for (const d of planned) {
      console.log(`  • ${d.name} [tenant ${d.tenantId}] → SKUs ${d.skus.join(', ')}`);
    }
    if (unmatched.length) console.log(`  ⚠️  no product with SKU: ${unmatched.join(', ')}`);
    if (!COMMIT) {
      console.log('\nDry run — re-run with --commit to write.');
      return;
    }

    const startDate = new Date(`${file.startDate}T00:00:00.000Z`);
    const endDate = new Date(`${file.endDate}T23:59:59.000Z`);
    for (const d of planned) {
      const existing = await prisma.merchDiscount.findFirst({
        where: { tenantId: d.tenantId, name: d.name, deletedAt: null },
      });
      const data = {
        type: 'PERCENT' as const,
        value: d.percent,
        startDate,
        endDate,
        isActive: true,
        products: { set: d.productIds.map(id => ({ id })) },
      };
      if (existing) {
        await prisma.merchDiscount.update({ where: { id: existing.id }, data });
        console.log(`  ✅ updated ${d.name}`);
      } else {
        await prisma.merchDiscount.create({
          data: {
            ...data,
            name: d.name,
            tenantId: d.tenantId,
            products: { connect: d.productIds.map(id => ({ id })) },
          },
        });
        console.log(`  ✅ created ${d.name}`);
      }
    }
    console.log('\n🎉 Done.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error('❌ Discount import failed:', e);
    process.exit(1);
  });
}
