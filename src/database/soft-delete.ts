import { Prisma } from '@prisma/client';

/**
 * Models that are soft-deleted (they have a `deletedAt` column). Deleting from any other model
 * (e.g. rider-rally links, user roles, acceptance letters) must really delete the row: rewriting
 * it to `update({ deletedAt })` fails with "Unknown argument `deletedAt`".
 */
export const SOFT_DELETE_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter(model => model.fields.some(field => field.name === 'deletedAt'))
    .map(model => model.name)
);

/** The update operation a delete becomes for a soft-deleted model, or null to run it as is. */
export function softDeleteOperation(
  operation: string,
  model: string | undefined
): 'update' | 'updateMany' | null {
  if (!model || !SOFT_DELETE_MODELS.has(model)) return null;
  if (operation === 'delete') return 'update';
  if (operation === 'deleteMany') return 'updateMany';
  return null;
}
