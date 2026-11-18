import { randomBytes } from 'crypto';

/** 24 random bytes → 32 base64url characters (192 bits): not guessable, safe in a URL path. */
const TOKEN_BYTES = 24;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function generateAcceptanceToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Cheap shape check so malformed input never reaches a database lookup. */
export function isAcceptanceToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** The rider's private acceptance-letter link on the public site. */
export function acceptanceUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/acceptance/${token}`;
}
