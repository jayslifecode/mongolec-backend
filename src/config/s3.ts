import { S3Client } from '@aws-sdk/client-s3';

const { B2_ENDPOINT, B2_REGION, B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY } = process.env;

/**
 * Normalize the S3 endpoint so it always includes a scheme.
 * The AWS SDK parses the endpoint with `new URL()`, which throws
 * `TypeError: Invalid URL` if the scheme (https://) is missing — this would
 * surface as an opaque "Internal server error" on every presigned-URL request.
 */
export const normalizeEndpoint = (endpoint?: string): string | undefined => {
  if (!endpoint) return undefined;
  const trimmed = endpoint.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const endpoint = normalizeEndpoint(B2_ENDPOINT);

const isConfigured = !!(endpoint && B2_REGION && B2_ACCESS_KEY_ID && B2_SECRET_ACCESS_KEY);

export const s3Client = isConfigured
  ? new S3Client({
      endpoint: endpoint!,
      region: B2_REGION!,
      credentials: {
        accessKeyId: B2_ACCESS_KEY_ID!,
        secretAccessKey: B2_SECRET_ACCESS_KEY!,
      },
    })
  : null;
