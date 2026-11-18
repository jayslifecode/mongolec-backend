/**
 * Where the public Rally for Rangers site lives, for acceptance links. Set RFR_SITE_URL once the
 * rallyforrangers.org domain points at the new site; until then the site is on Vercel.
 */
export const DEFAULT_RFR_SITE_URL = 'https://rally-for-rangers-website.vercel.app';

export function getRfrSiteUrl(): string {
  return (process.env.RFR_SITE_URL || DEFAULT_RFR_SITE_URL).replace(/\/+$/, '');
}
