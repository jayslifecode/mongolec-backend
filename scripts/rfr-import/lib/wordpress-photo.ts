/**
 * Rally for Rangers — resolve a WordPress-hosted photo to its B2 copy.
 *
 * Reuses an already-uploaded copy from the manifest; otherwise uploads one, but only when
 * `allowReupload` is set (i.e. on `--commit`). A dry run must have no side effects on
 * production storage, so it reports the upload as pending instead. Pure apart from the
 * injected `reupload`.
 */
import type { Manifest } from './manifest';
import type { PortraitBucket } from './photo-match';

export type Reupload = (
  sourceUrl: string,
  bucket: PortraitBucket,
  slug: string,
  manifest: Manifest
) => Promise<string | null>;

export interface WordpressPhotoOptions {
  allowReupload: boolean;
  reupload: Reupload;
}

export interface WordpressPhotoResult {
  /** B2 URL, or null when there is none (yet). */
  url: string | null;
  /** True when a dry run skipped an upload that `--commit` would perform. */
  pending: boolean;
}

export async function wordpressPhoto(
  sourceUrl: string,
  bucket: PortraitBucket,
  slug: string,
  manifest: Manifest,
  { allowReupload, reupload }: WordpressPhotoOptions
): Promise<WordpressPhotoResult> {
  const existing = manifest[`rfr/${bucket}/${slug}.webp`];
  if (existing) return { url: existing.url, pending: false };
  if (!allowReupload) return { url: null, pending: true };
  return { url: await reupload(sourceUrl, bucket, slug, manifest), pending: false };
}
