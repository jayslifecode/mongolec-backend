import { planRiderSync, riderSlug } from './rider-sync';

/**
 * The database side of confirming a rider (round 4): create or update their Participant
 * (featured photo + bio from the acceptance letter) and link them to the rally, so they appear
 * on the roster and on the rally page. Runs inside the caller's transaction.
 */

interface ConfirmableApplication {
  id: string;
  tenantId: string;
  rallyId: string;
  firstName: string;
  lastName: string;
  country: string;
  rally: { startDate: Date | string | null };
  acceptance: {
    firstName: string;
    lastName: string;
    usePastPhotoAndBio: boolean;
    photoUrl: string | null;
    bio: string | null;
  };
}

const RIDER_ROLE = 'Rider';

function rallyYear(startDate: Date | string | null): number | null {
  if (!startDate) return null;
  const year = new Date(startDate).getUTCFullYear();
  return Number.isNaN(year) ? null : year;
}

export async function syncConfirmedRider(tx: any, application: ConfirmableApplication): Promise<string> {
  const { acceptance } = application;
  // The application's names (what admin reviewed and approved) pick the rider, never the names
  // typed in the letter, so a letter cannot redirect the update onto someone else's profile.
  const firstName = application.firstName;
  const lastName = application.lastName;
  const nameSlug = riderSlug(firstName, lastName);

  // Names with no Latin letters have no name slug: never match on it, give the new rider its own.
  // Soft-deleted riders are matched too: the slug is unique per tenant, and a returning rider revives.
  const existing = nameSlug
    ? await tx.participant.findFirst({
        where: { tenantId: application.tenantId, slug: nameSlug },
        select: { id: true, photo: true, bio: true },
      })
    : null;

  const plan = planRiderSync({
    firstName,
    lastName,
    slug: nameSlug || `rider-${application.id}`,
    country: application.country,
    acceptance,
    existing,
  });

  const participantId =
    plan.kind === 'create'
      ? (await tx.participant.create({ data: { ...plan.data, tenantId: application.tenantId } })).id
      : (await tx.participant.update({ where: { id: plan.id }, data: { ...plan.data, deletedAt: null, isActive: true } })).id ?? plan.id;

  const year = rallyYear(application.rally.startDate);
  await tx.participantRally.upsert({
    where: { participantId_rallyId: { participantId, rallyId: application.rallyId } },
    create: { participantId, rallyId: application.rallyId, year, role: RIDER_ROLE },
    update: { year },
  });

  return participantId;
}
