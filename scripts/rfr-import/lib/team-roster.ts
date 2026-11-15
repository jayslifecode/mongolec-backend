/**
 * Rally for Rangers — public team roster (`data/team-roster.json`).
 *
 * The file is the single source for who appears under "Our Team" and in what order: array
 * position = displayOrder. `photoKey` is an image-manifest key (rfr/team/*.webp or a rider
 * portrait), resolved to a URL by the importer. Pure, no IO.
 */

export interface RosterMember {
  name: string;
  role: string;
  bio: string;
  photoKey: string | null;
  displayOrder: number;
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Parse and validate the roster JSON; throws naming the 1-based entry on a missing name/role. */
export function loadRoster(raw: string): RosterMember[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('team roster must be a JSON array');

  return parsed.map((entry: Record<string, unknown>, i) => {
    const label = `team roster entry ${i + 1}`;
    if (!nonEmpty(entry?.name)) throw new Error(`${label}: name is required`);
    if (!nonEmpty(entry.role)) throw new Error(`${label} (${entry.name}): role is required`);
    return {
      name: entry.name.trim(),
      role: entry.role.trim(),
      bio: typeof entry.bio === 'string' ? entry.bio.trim() : '',
      photoKey: nonEmpty(entry.photoKey) ? entry.photoKey.trim() : null,
      displayOrder: i,
    };
  });
}

export interface TeamMemberRow {
  name: string;
  role: string;
  bio: string | null;
  photo: string | null;
  displayOrder: number;
  isActive: boolean;
}

/** The subset of a Prisma client the team upsert uses. */
export interface TeamMemberClient {
  teamMember: {
    findFirst(args: { where: { tenantId: string; name: string; deletedAt: null } }): Promise<{ id: string } | null>;
    update(args: {
      where: { id: string };
      data: Omit<TeamMemberRow, 'name'>;
    }): Promise<unknown>;
    create(args: { data: TeamMemberRow & { tenantId: string } }): Promise<unknown>;
  };
}

/**
 * Upsert by (tenant, name) against live rows only: a soft-deleted row with the same name is
 * left alone (updating it would leave the member hidden, since public queries skip deleted rows).
 */
export async function upsertTeamMember(
  client: TeamMemberClient,
  tenantId: string,
  member: TeamMemberRow
): Promise<'created' | 'updated'> {
  const existing = await client.teamMember.findFirst({ where: { tenantId, name: member.name, deletedAt: null } });
  const { name, ...data } = member;
  if (existing) {
    await client.teamMember.update({ where: { id: existing.id }, data });
    return 'updated';
  }
  await client.teamMember.create({ data: { ...data, name, tenantId } });
  return 'created';
}
