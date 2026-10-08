/**
 * Merch — set product stock (and SKU corrections) from the client's count sheet.
 *
 * Source: scripts/merch-import/data/stock-<date>.json. `skuFixes` renames SKUs first so the
 * sheet code matches the product; `stock` then sets `inventory` on the product (products here
 * carry stock at product level — variants are empty). Only products whose current value differs
 * are written. No deletes.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/merch-import/apply-stock.ts            # dry run
 *   npx ts-node -r dotenv/config scripts/merch-import/apply-stock.ts --commit   # write
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface StockFile {
  skuFixes?: Array<{ from: string; to: string; why?: string }>;
  stock: Array<{ sku: string; inventory: number }>;
}

const DEFAULT_FILE = path.join(__dirname, 'data', 'stock-2026-10-06.json');
const COMMIT = process.argv.includes('--commit');

function readStockFile(filePath: string): StockFile {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StockFile;
  if (!Array.isArray(raw.stock) || raw.stock.length === 0)
    throw new Error(`No stock rows in ${filePath}`);
  for (const row of raw.stock) {
    if (!row.sku || !Number.isInteger(row.inventory) || row.inventory < 0) {
      throw new Error(`Invalid stock row ${JSON.stringify(row)}`);
    }
  }
  return raw;
}

async function main(): Promise<void> {
  const file = readStockFile(process.env.STOCK_FILE ?? DEFAULT_FILE);
  const prisma = new PrismaClient();
  try {
    const products = await prisma.merchProduct.findMany({
      where: { deletedAt: null },
      select: { id: true, sku: true, inventory: true },
    });
    const bySku = new Map(products.filter(p => p.sku).map(p => [p.sku as string, p]));

    const skuPlan = (file.skuFixes ?? []).filter(f => bySku.has(f.from) && !bySku.has(f.to));
    for (const f of skuPlan)
      console.log(`  • SKU ${f.from} → ${f.to}${f.why ? ` (${f.why})` : ''}`);

    const resolveSku = (sku: string): string => skuPlan.find(f => f.to === sku)?.from ?? sku;
    const stockPlan = file.stock
      .map(row => ({ ...row, product: bySku.get(resolveSku(row.sku)) }))
      .filter(row => row.product && row.product.inventory !== row.inventory);
    const unmatched = file.stock.filter(row => !bySku.get(resolveSku(row.sku))).map(r => r.sku);
    for (const row of stockPlan) {
      console.log(`  • ${row.sku}: inventory ${row.product?.inventory} → ${row.inventory}`);
    }
    if (unmatched.length) console.log(`  ⚠️  no product with SKU: ${unmatched.join(', ')}`);
    console.log(`📋 ${skuPlan.length} SKU fix(es), ${stockPlan.length} stock change(s)`);
    if (!COMMIT) {
      console.log('\nDry run — re-run with --commit to write.');
      return;
    }

    for (const f of skuPlan) {
      const p = bySku.get(f.from);
      if (p) await prisma.merchProduct.update({ where: { id: p.id }, data: { sku: f.to } });
    }
    for (const row of stockPlan) {
      if (row.product) {
        await prisma.merchProduct.update({
          where: { id: row.product.id },
          data: { inventory: row.inventory },
        });
      }
    }
    console.log('\n🎉 Done.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error('❌ Stock import failed:', e);
    process.exit(1);
  });
}
