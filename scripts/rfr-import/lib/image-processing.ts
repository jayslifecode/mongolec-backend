/**
 * Rally for Rangers — local image resize + WebP conversion.
 *
 * Shells out to macOS `sips` (resize) and `cwebp` (convert), since this machine has neither
 * sharp nor ImageMagick installed. IO-heavy by nature; kept thin and easy to mock in tests.
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CWEBP_BIN = '/opt/local/bin/cwebp';
const WEBP_QUALITY = 82;

export interface ProcessedImage {
  width: number;
  height: number;
}

/**
 * Resizes `source` to `maxDim` on its longest edge and converts it to WebP at `destWebp`.
 * Uses a temp JPEG in between because `sips` cannot write WebP directly.
 */
export async function resizeAndConvertToWebp(
  source: string,
  destWebp: string,
  maxDim: number,
  tmpDir: string
): Promise<ProcessedImage> {
  await fs.promises.mkdir(tmpDir, { recursive: true });
  await fs.promises.mkdir(path.dirname(destWebp), { recursive: true });

  const tmpResized = path.join(tmpDir, `${path.basename(destWebp, '.webp')}-${Date.now()}.jpg`);
  await fs.promises.copyFile(source, tmpResized);
  await execFileAsync('sips', ['-Z', String(maxDim), tmpResized]);
  await execFileAsync(CWEBP_BIN, ['-q', String(WEBP_QUALITY), tmpResized, '-o', destWebp]);

  const dims = await getImageDimensions(tmpResized);
  await fs.promises.unlink(tmpResized).catch(() => undefined);
  return dims;
}

/** Reads width/height via `sips -g pixelWidth -g pixelHeight`. */
export async function getImageDimensions(filePath: string): Promise<ProcessedImage> {
  const { stdout } = await execFileAsync('sips', [
    '-g',
    'pixelWidth',
    '-g',
    'pixelHeight',
    filePath,
  ]);
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);
  return { width, height };
}
