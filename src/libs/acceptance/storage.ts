import { randomBytes } from 'crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '@/config/s3';
import { resolvePublicBaseUrl } from '@/libs/file-storage';
import type { DecodedAcceptanceFile } from './files';
import { createLogger } from '@/utils/logger';

const logger = createLogger('ACCEPTANCE_STORAGE');

const RIDER_PHOTO_PREFIX = 'rfr/riders/acceptance';

/**
 * Uploads a rider's acceptance photo to public storage (it becomes their featured photo on the
 * roster). The key carries a random suffix so a new photo never overwrites an older one.
 */
export async function uploadAcceptancePhoto(file: DecodedAcceptanceFile, slug: string): Promise<string> {
  if (!s3Client) throw new Error('Photo storage is not configured.');
  const key = `${RIDER_PHOTO_PREFIX}/${slug || 'rider'}-${randomBytes(6).toString('hex')}.${file.extension}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimeType,
    })
  );
  return `${resolvePublicBaseUrl()}/${key}`;
}

/** Best-effort removal of an uploaded photo whose acceptance letter then failed to save. */
export async function deleteAcceptancePhoto(url: string): Promise<void> {
  if (!s3Client) return;
  const base = `${resolvePublicBaseUrl()}/`;
  if (!url.startsWith(`${base}${RIDER_PHOTO_PREFIX}/`)) return;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: url.slice(base.length) }));
  } catch (error) {
    logger.error('Could not remove orphaned acceptance photo', error instanceof Error ? error : undefined, { url });
  }
}
