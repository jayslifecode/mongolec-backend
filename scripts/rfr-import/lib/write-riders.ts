/**
 * Rally for Rangers — the rider write path (production data).
 *
 * `planRiderWrite` is pure: which importer-owned rows (`rfr-rider-*`) go away and which rider
 * each merges into, plus any non-importer participant already holding a slug we are about to
 * write (the unique `(slug, tenantId)` index would abort the import half-way). `applyRiderWrite`
 * performs the plan against a client — the importer passes a Prisma interactive-transaction
 * client so the whole write is atomic.
 */
import { riderMergeKey, splitRiderName, type MergedRider } from './rider-merge';

export type ResolvedRider = MergedRider & { id: string; slug: string; photo: string | null };

export interface ExistingParticipantRow {
  id: string;
  slug: string;
  firstName: string;
  lastName: string;
}

export interface RiderWritePlan {
  toDelete: Array<{ id: string; name: string; mergedInto: string | null }>;
  collisions: Array<{ id: string; slug: string; name: string }>;
}

const IMPORTER_ID_PREFIX = 'rfr-rider-';

export function planRiderWrite(existing: ExistingParticipantRow[], riders: ResolvedRider[]): RiderWritePlan {
  const producedIds = new Set(riders.map(r => r.id));
  const producedSlugs = new Set(riders.map(r => r.slug));
  const idByKey = new Map(riders.map(r => [riderMergeKey(r.displayName), r.id]));
  const nameOf = (row: ExistingParticipantRow) => `${row.firstName} ${row.lastName}`.trim();

  const toDelete = existing
    .filter(row => row.id.startsWith(IMPORTER_ID_PREFIX) && !producedIds.has(row.id))
    .map(row => ({ id: row.id, name: nameOf(row), mergedInto: idByKey.get(riderMergeKey(nameOf(row))) ?? null }));
  const collisions = existing
    .filter(row => !row.id.startsWith(IMPORTER_ID_PREFIX) && producedSlugs.has(row.slug))
    .map(row => ({ id: row.id, slug: row.slug, name: nameOf(row) }));

  return { toDelete, collisions };
}

interface ParticipantFields {
  firstName: string;
  lastName: string;
  slug: string;
  country: string;
  bio: string | null;
  photo: string | null;
  isActive: boolean;
  deletedAt: null;
}

/** The subset of a Prisma (transaction) client the write path uses. */
export interface RiderWriteClient {
  participant: {
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<unknown>;
    upsert(args: {
      where: { id: string };
      update: ParticipantFields;
      create: ParticipantFields & { id: string; displayOrder: number; tenantId: string };
    }): Promise<unknown>;
  };
  participantRally: {
    deleteMany(args: {
      where: { participantId: { in: string[] } } | { participantId: string; rallyId?: { in: string[] } };
    }): Promise<unknown>;
    create(args: {
      data: { participantId: string; rallyId: string; year: number | null; role: string };
    }): Promise<unknown>;
  };
}

export interface ApplyRiderWriteInput {
  tenantId: string;
  rallyIdBySlug: Map<string, string>;
  riders: ResolvedRider[];
  plan: RiderWritePlan;
  /**
   * Master-sheet mode: only links to these rallies are replaced; links to rallies outside the
   * sheet (e.g. future rallies) are kept. Omitted = replace every link (default import).
   */
  managedRallySlugs?: Set<string>;
}

function nameParts(r: ResolvedRider): { firstName: string; lastName: string } {
  if (r.firstName !== undefined) return { firstName: r.firstName, lastName: r.lastName ?? '' };
  return splitRiderName(r.displayName);
}

export async function applyRiderWrite(
  client: RiderWriteClient,
  { tenantId, rallyIdBySlug, riders, plan, managedRallySlugs }: ApplyRiderWriteInput
): Promise<{ ridersWritten: number; linksWritten: number; deleted: number }> {
  if (plan.collisions.length) {
    const list = plan.collisions.map(c => `${c.slug} (${c.id}, ${c.name})`).join(', ');
    throw new Error(`Slug collision with non-importer participants — resolve these first: ${list}`);
  }

  if (plan.toDelete.length) {
    const ids = plan.toDelete.map(p => p.id);
    await client.participantRally.deleteMany({ where: { participantId: { in: ids } } });
    await client.participant.deleteMany({ where: { id: { in: ids } } });
  }

  const managedRallyIds = managedRallySlugs
    ? Array.from(managedRallySlugs).flatMap(slug => rallyIdBySlug.get(slug) ?? [])
    : null;

  let linksWritten = 0;
  for (const [index, r] of riders.entries()) {
    const fields: ParticipantFields = {
      ...nameParts(r),
      slug: r.slug,
      country: r.country,
      bio: r.bio || null,
      photo: r.photo,
      isActive: true,
      deletedAt: null,
    };
    await client.participant.upsert({
      where: { id: r.id },
      update: fields,
      create: { ...fields, id: r.id, displayOrder: index, tenantId },
    });
    await client.participantRally.deleteMany({
      where: managedRallyIds ? { participantId: r.id, rallyId: { in: managedRallyIds } } : { participantId: r.id },
    });
    for (const [slug, { year, role }] of r.rallies.entries()) {
      const rallyId = rallyIdBySlug.get(slug);
      if (!rallyId) continue;
      await client.participantRally.create({
        data: { participantId: r.id, rallyId, year, role: role ?? 'Rider' },
      });
      linksWritten++;
    }
  }
  return { ridersWritten: riders.length, linksWritten, deleted: plan.toDelete.length };
}
