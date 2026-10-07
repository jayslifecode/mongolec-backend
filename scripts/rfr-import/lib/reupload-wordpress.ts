/**
 * Rally for Rangers — re-upload a WordPress-hosted photo into B2.
 *
 * Used as a fallback when a rider/ranger/team member's only photo is a
 * `rallyforrangers.org/wp-content/...` URL: download it, resize + convert to WebP the same
 * way `upload-images.ts` does, and upload it to B2 so no WordPress hotlinks remain live.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { objectExists, uploadWebp } from './b2-upload';
import { resizeAndConvertToWebp } from './image-processing';
import { Manifest } from './manifest';
import { PortraitBucket } from './photo-match';

const DOWNLOAD_TIMEOUT_MS = 8_000;

/**
 * Downloads `sourceUrl`, converts it to a `900`px-max WebP, uploads it to
 * `rfr/<bucket>/<slug>.webp`, and records the result in `manifest`. Returns the new public
 * URL, or null if the download/convert/upload failed (caller should keep the original URL).
 */
export async function reuploadWordpressPhoto(
  sourceUrl: string,
  bucket: PortraitBucket,
  slug: string,
  manifest: Manifest,
  tmpDir: string = path.join(os.tmpdir(), 'rfr-reupload')
): Promise<string | null> {
  const key = `rfr/${bucket}/${slug}.webp`;
  const existingEntry = manifest[key];
  if (existingEntry) return existingEntry.url;
  if (await objectExists(key)) return `${process.env.B2_PUBLIC_URL}/${key}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const response = await fetch(sourceUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;

    await fs.promises.mkdir(tmpDir, { recursive: true });
    const ext = path.extname(new URL(sourceUrl).pathname) || '.jpg';
    const downloaded = path.join(tmpDir, `${slug}-src${ext}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(downloaded, buffer);

    const destWebp = path.join(tmpDir, `${key.replace(/^rfr\//, '')}`);
    const { width, height } = await resizeAndConvertToWebp(downloaded, destWebp, 900, tmpDir);
    const url = await uploadWebp(key, destWebp);
    manifest[key] = { url, source: sourceUrl, width, height };
    return url;
  } catch {
    return null;
  }
}
