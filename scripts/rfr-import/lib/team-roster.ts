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
