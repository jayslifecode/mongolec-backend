/**
 * Confirming an application puts the rider on the public roster (round 4). New riders are
 * created with the acceptance photo as their featured photo; returning riders get the new rally
 * photo as their featured photo (the latest rally wins) unless they chose to reuse their past
 * photo and bio.
 */

export interface RiderSyncAcceptance {
  usePastPhotoAndBio: boolean;
  photoUrl: string | null;
  bio: string | null;
}

export interface RiderSyncExisting {
  id: string;
  photo: string | null;
  bio: string | null;
}

export interface RiderSyncInput {
  firstName: string;
  lastName: string;
  /** Slug for a new rider; defaults to the name slug (callers pass a fallback when that is empty). */
  slug?: string;
  country: string;
  acceptance: RiderSyncAcceptance | null;
  existing: RiderSyncExisting | null;
}

export interface RiderCreateData {
  firstName: string;
  lastName: string;
  slug: string;
  country: string;
  photo: string | null;
  bio: string | null;
}

export type RiderSyncPlan =
  | { kind: 'create'; data: RiderCreateData }
  | { kind: 'update'; id: string; data: { photo?: string; bio?: string } };

/** Same rule as the importer: accents folded, lowercase, runs of other characters → "-". */
export function riderSlug(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function planRiderSync(input: RiderSyncInput): RiderSyncPlan {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const fresh = input.acceptance && !input.acceptance.usePastPhotoAndBio ? input.acceptance : null;
  const newPhoto = fresh?.photoUrl || undefined;
  const newBio = fresh?.bio?.trim() || undefined;

  if (input.existing) {
    return {
      kind: 'update',
      id: input.existing.id,
      data: {
        ...(newPhoto && { photo: newPhoto }),
        ...(newBio && { bio: newBio }),
      },
    };
  }

  return {
    kind: 'create',
    data: {
      firstName,
      lastName,
      slug: input.slug || riderSlug(firstName, lastName),
      country: input.country,
      photo: newPhoto ?? null,
      bio: newBio ?? null,
    },
  };
}
