import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../config/s3';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('FILE_STORAGE');

const { B2_BUCKET_NAME, B2_PUBLIC_URL, B2_ENDPOINT, MAX_FILE_SIZE } = process.env;

// Maximum file size (10MB default, can be overridden via env)
const MAX_UPLOAD_SIZE = parseInt(MAX_FILE_SIZE || '10485760', 10); // 10MB in bytes

/**
 * Resolve the public base URL used to build the final, browser-facing file URL.
 * Prefers B2_PUBLIC_URL; if it is not set, derives a virtual-hosted-style URL
 * from the bucket + endpoint host (e.g. https://Bucket.s3.region.backblazeb2.com)
 * so a missing B2_PUBLIC_URL never produces an "undefined/..." link. Throws a
 * clear error if it cannot be resolved, instead of silently saving a broken URL.
 */
export function resolvePublicBaseUrl(): string {
  if (B2_PUBLIC_URL) {
    return B2_PUBLIC_URL.replace(/\/+$/, '');
  }
  if (B2_ENDPOINT && B2_BUCKET_NAME) {
    const host = B2_ENDPOINT.trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');
    // Lowercase: next/image lowercases the URL host before matching remotePatterns,
    // so the public host must be lowercase to render via the storefront optimizer.
    return `https://${B2_BUCKET_NAME}.${host}`.toLowerCase();
  }
  throw new Error(
    'Public file URL cannot be resolved: set B2_PUBLIC_URL (or B2_ENDPOINT + B2_BUCKET_NAME).'
  );
}

/**
 * Allowed MIME types for upload
 * This whitelist prevents malicious file uploads
 */
const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',

  // Videos
  'video/mp4',
  'video/webm',
  'video/quicktime',

  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  // Audio
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
] as const;

/**
 * Magic byte signatures for common file types
 * Used to verify actual file content matches declared MIME type
 */
const MAGIC_BYTES: Record<string, Buffer> = {
  // Images
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  'image/gif': Buffer.from([0x47, 0x49, 0x46]),
  'image/webp': Buffer.from([0x52, 0x49, 0x46, 0x46]),

  // Videos
  'video/mp4': Buffer.from([0x00, 0x00, 0x00]),
  'video/webm': Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),

  // PDF
  'application/pdf': Buffer.from([0x25, 0x50, 0x44, 0x46]),
};

export interface PresignedUrlResponse {
  uploadUrl: string;
  fileUrl: string;
}

/**
 * Validates if a MIME type is allowed
 * @param fileType The MIME type to validate
 * @returns true if allowed, false otherwise
 */
export function isValidMimeType(fileType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(fileType as any);
}

/**
 * Validates file magic bytes match the declared MIME type
 * @param buffer First few bytes of the file
 * @param fileType The declared MIME type
 * @returns true if magic bytes match, false otherwise
 */
export function validateMagicBytes(buffer: Buffer, fileType: string): boolean {
  const magicBytes = MAGIC_BYTES[fileType];

  // If we don't have magic bytes for this type, allow it (client-side validation should handle it)
  if (!magicBytes) {
    return true;
  }

  // Check if the buffer starts with the expected magic bytes
  return buffer.subarray(0, magicBytes.length).equals(magicBytes);
}

/**
 * Get file extension from MIME type
 * @param fileType The MIME type
 * @returns The file extension
 */
export function getExtensionFromMimeType(fileType: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
  };

  return extensions[fileType] || 'bin';
}

/**
 * Generates a pre-signed URL for uploading a file to Backblaze B2.
 * @param fileType The MIME type of the file to be uploaded (e.g., 'image/jpeg').
 * @returns An object containing the pre-signed upload URL and the final public URL of the file.
 * @throws Error if fileType is invalid or not allowed
 */
export const getPresignedUploadUrl = async (fileType: string): Promise<PresignedUrlResponse> => {
  // Validate MIME type
  if (!fileType) {
    logger.warn('Upload attempt without file type');
    throw new Error("A 'fileType' argument is required.");
  }

  if (!isValidMimeType(fileType)) {
    logger.warn(`Upload attempt with disallowed file type: ${fileType}`);
    throw new Error(
      `File type '${fileType}' is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }

  // Generate a unique key for the file in the bucket
  const fileExtension = getExtensionFromMimeType(fileType);
  const key = `uploads/${randomUUID()}.${fileExtension}`;

  const command = new PutObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: key,
    ContentType: fileType,
    // Add content length restrictions to presigned URL
    // Note: This is a hint to the client; actual enforcement requires S3 bucket policies
  });

  // The pre-signed URL is valid for 1 hour
  if (!s3Client) {
    throw new Error('File storage is not configured.');
  }

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  // Construct the public URL for the file once uploaded
  const fileUrl = `${resolvePublicBaseUrl()}/${key}`;

  logger.info(`Generated presigned URL for file type: ${fileType}`, {
    fileType,
    fileExtension,
    maxSize: MAX_UPLOAD_SIZE,
  });

  return { uploadUrl, fileUrl };
};

/**
 * Validates uploaded file metadata after upload
 * This should be called after file upload to verify the file
 * @param fileUrl The URL of the uploaded file
 * @param expectedMimeType The expected MIME type
 * @param fileSize The size of the uploaded file
 * @returns true if validation passes
 */
export const validateUploadedFile = (
  fileUrl: string,
  expectedMimeType: string,
  fileSize: number
): boolean => {
  // Check file size
  if (fileSize > MAX_UPLOAD_SIZE) {
    logger.warn(`File upload exceeds maximum size: ${fileSize} > ${MAX_UPLOAD_SIZE}`, { fileUrl });
    return false;
  }

  // Check MIME type is still allowed
  if (!isValidMimeType(expectedMimeType)) {
    logger.warn(`Invalid MIME type for uploaded file: ${expectedMimeType}`, { fileUrl });
    return false;
  }

  return true;
};
