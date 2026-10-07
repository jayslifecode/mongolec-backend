/**
 * Rally for Rangers — Backblaze B2 upload helpers (thin wrapper over the shared S3 client).
 */
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import { s3Client } from '../../../src/config/s3';

const { B2_BUCKET_NAME, B2_PUBLIC_URL } = process.env;

export function publicUrlFor(key: string): string {
  return `${B2_PUBLIC_URL}/${key}`;
}

export async function objectExists(key: string): Promise<boolean> {
  if (!s3Client) throw new Error('B2 (S3) client is not configured — check B2_* env vars.');
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }));
    return true;
  } catch (error: unknown) {
    const code = (error as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    if (code === 'NotFound' || status === 404) return false;
    throw error;
  }
}

export async function uploadWebp(key: string, localPath: string): Promise<string> {
  if (!s3Client) throw new Error('B2 (S3) client is not configured — check B2_* env vars.');
  const body = await fs.promises.readFile(localPath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
    })
  );
  return publicUrlFor(key);
}
