/**
 * Files riders attach to the acceptance letter arrive base64-encoded inside the GraphQL request
 * (the website shrinks photos first). Each file is checked against a policy: declared type,
 * real content (magic bytes) and size. Errors are user-facing.
 */

export interface AcceptanceFileInput {
  fileName: string;
  mimeType: string;
  base64: string;
}

export interface AcceptanceFilePolicy {
  label: string;
  allowedMimeTypes: readonly string[];
  /** Human list for messages, e.g. "a JPG, PNG or WebP image". */
  allowedDescription: string;
  maxBytes: number;
}

export interface DecodedAcceptanceFile {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  fileName: string;
}

const MB = 1024 * 1024;

export const ACCEPTANCE_PHOTO_POLICY: AcceptanceFilePolicy = {
  label: 'Photo',
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  allowedDescription: 'a JPG, PNG or WebP image',
  maxBytes: 5 * MB,
};

export const ACCEPTANCE_PASSPORT_POLICY: AcceptanceFilePolicy = {
  label: 'Passport copy',
  allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  allowedDescription: 'a JPG, PNG or PDF file',
  maxBytes: 4 * MB,
};

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const DATA_URL_PREFIX = /^data:[^;,]+;base64,/;
const UNSAFE_FILE_NAME_CHARS = /[^A-Za-z0-9._-]/g;
const MAX_FILE_NAME_LENGTH = 120;

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

function contentMatches(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/webp':
      return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'application/pdf':
      return buffer.subarray(0, 4).toString('latin1') === '%PDF';
    default:
      return false;
  }
}

/** Basename only, unsafe characters replaced, length capped. */
function safeFileName(name: string, extension: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(UNSAFE_FILE_NAME_CHARS, '_').slice(-MAX_FILE_NAME_LENGTH);
  return base && base !== '.' && base !== '..' ? base : `file.${extension}`;
}

export function decodeAcceptanceFile(file: AcceptanceFileInput, policy: AcceptanceFilePolicy): DecodedAcceptanceFile {
  const mimeType = (file.mimeType ?? '').toLowerCase();
  if (!policy.allowedMimeTypes.includes(mimeType)) {
    throw new Error(`${policy.label} must be ${policy.allowedDescription}.`);
  }
  const base64 = (file.base64 ?? '').replace(DATA_URL_PREFIX, '');
  // Reject oversize input before decoding: base64 is 4 chars per 3 bytes.
  if (Math.floor((base64.length * 3) / 4) > policy.maxBytes + 2) {
    throw new Error(`${policy.label} is too large (max ${policy.maxBytes / MB} MB).`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new Error(`${policy.label} is empty.`);
  if (buffer.length > policy.maxBytes) {
    throw new Error(`${policy.label} is too large (max ${policy.maxBytes / MB} MB).`);
  }
  if (!contentMatches(buffer, mimeType)) {
    throw new Error(`${policy.label} does not look like ${policy.allowedDescription}.`);
  }
  const extension = EXTENSIONS[mimeType];
  return { buffer, mimeType, extension, fileName: safeFileName(file.fileName ?? '', extension) };
}
