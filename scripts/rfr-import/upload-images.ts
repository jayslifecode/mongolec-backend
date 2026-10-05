/**
 * Rally for Rangers — image uploader.
 *
 * Walks `~/Downloads/Website 2`, resizes every image with macOS `sips` and converts it to
 * WebP with `cwebp`, uploads the result to Backblaze B2 (skipping any key that already
 * exists), and writes `data/image-manifest.json` (key -> { url, source, width, height }).
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/rfr-import/upload-images.ts --dry-run   # plan only
 *   npx ts-node -r dotenv/config scripts/rfr-import/upload-images.ts --limit 20  # first 20 only
 *   npx ts-node -r dotenv/config scripts/rfr-import/upload-images.ts             # full run
 */
import * as os from 'os';
import * as path from 'path';
import { objectExists, uploadWebp } from './lib/b2-upload';
import { ASSETS_ROOT, dedupeByKey, discoverAssets, UploadItem } from './lib/discover-assets';
import { resizeAndConvertToWebp } from './lib/image-processing';
import { Manifest, readManifest, writeManifest } from './lib/manifest';

const CONCURRENCY = 4;
const SCRATCHPAD_WEBP_DIR = path.join(
  '/private/tmp/claude-501/-Users-munkhjavkhlan-Mongolec/7ee57fed-4e01-44f9-96aa-7ac96350b1cb/scratchpad',
  'webp'
);

interface Args {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const dryRun = argv.includes('--dry-run');
  const limitFlagIndex = argv.indexOf('--limit');
  const limit = limitFlagIndex >= 0 ? Number(argv[limitFlagIndex + 1]) : null;
  return { dryRun, limit: limit && limit > 0 ? limit : null };
}

async function processItem(item: UploadItem, manifest: Manifest): Promise<void> {
  const alreadyUploaded = !!manifest[item.key];
  const existsRemotely = alreadyUploaded || (await objectExists(item.key));
  if (existsRemotely) {
    if (!manifest[item.key]) {
      // Uploaded in a previous run but manifest lost the entry — re-derive the URL only.
      const { publicUrlFor } = await import('./lib/b2-upload');
      manifest[item.key] = {
        url: publicUrlFor(item.key),
        source: item.source,
        width: 0,
        height: 0,
      };
    }
    console.log(`  = skip (exists)  ${item.key}`);
    return;
  }

  const destWebp = path.join(SCRATCHPAD_WEBP_DIR, item.key.replace(/^rfr\//, ''));
  const { width, height } = await resizeAndConvertToWebp(
    item.source,
    destWebp,
    item.maxDim,
    SCRATCHPAD_WEBP_DIR
  );
  const url = await uploadWebp(item.key, destWebp);
  manifest[item.key] = { url, source: item.source, width, height };
  console.log(`  + uploaded       ${item.key}  (${width}x${height})`);
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i]);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));

  console.log(`📁 Scanning ${ASSETS_ROOT} ...`);
  let items = dedupeByKey(discoverAssets());
  console.log(`📋 ${items.length} source images discovered (deduplicated by destination key).`);
  if (limit) {
    items = items.slice(0, limit);
    console.log(`✂️  Limited to first ${items.length} items.`);
  }

  const byBucket = new Map<string, number>();
  for (const item of items) {
    const bucket = item.key.split('/')[1] ?? 'other';
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
  }
  console.log('📊 By bucket:');
  for (const [bucket, count] of byBucket) console.log(`   rfr/${bucket}: ${count}`);

  if (dryRun) {
    console.log('\n🚫 Dry run — no resize/upload performed. Sample plan:');
    for (const item of items.slice(0, 10)) {
      console.log(`  ${item.key.padEnd(40)} <- ${item.source} (max ${item.maxDim}px)`);
    }
    return;
  }

  const manifest = readManifest();
  let processed = 0;
  await runWithConcurrency(items, CONCURRENCY, async item => {
    try {
      await processItem(item, manifest);
    } catch (error) {
      console.error(`  ❌ failed ${item.key}:`, error instanceof Error ? error.message : error);
    } finally {
      processed++;
      if (processed % 25 === 0) console.log(`   ... ${processed}/${items.length}`);
    }
  });

  writeManifest(manifest);
  console.log(`\n🎉 Done. Manifest now has ${Object.keys(manifest).length} entries.`);
  console.log(`   tmp webp dir: ${SCRATCHPAD_WEBP_DIR} (on ${os.hostname()})`);
}

main().catch(e => {
  console.error('❌ Upload failed:', e);
  process.exit(1);
});
