import { checkPermission } from '@/auth';
import { AppError, ErrorType, type GraphQLContext } from '@/types';
import { PARTICIPANT_RALLY_INCLUDE } from '../queries/participant';

export interface CreateParticipantInput {
  firstName: string;
  lastName: string;
  photo?: string;
  country: string;
  bio?: string;
  displayOrder?: number;
  isActive?: boolean;
  slug?: string;
  honoraryTitle?: string;
  rallyIds?: string[];
}

export interface UpdateParticipantInput {
  firstName?: string;
  lastName?: string;
  photo?: string;
  country?: string;
  bio?: string;
  displayOrder?: number;
  isActive?: boolean;
  slug?: string;
  honoraryTitle?: string;
  rallyIds?: string[];
}

function kebab(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Generates a unique slug within the tenant: base kebab, then `-2`, `-3`, ... on collision. */
async function uniqueSlug(
  context: GraphQLContext,
  tenantId: string,
  base: string,
  excludeId?: string
): Promise<string> {
  const root = kebab(base) || 'rider';
  let candidate = root;
  let suffix = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await context.prisma.participant.findFirst({
      where: {
        tenantId,
        slug: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
}

/** Throws unless every rallyId belongs to this tenant. */
async function assertRallyIdsBelongToTenant(
  context: GraphQLContext,
  tenantId: string,
  rallyIds: string[]
): Promise<void> {
  if (rallyIds.length === 0) return;
  const owned = await context.prisma.rally.findMany({
    where: { id: { in: rallyIds }, tenantId, deletedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map(r => r.id));
  const foreign = rallyIds.filter(id => !ownedIds.has(id));
  if (foreign.length > 0) {
    throw new AppError(
      `rallyIds do not belong to this tenant: ${foreign.join(', ')}`,
      ErrorType.VALIDATION_ERROR,
      400
    );
  }
}

/** Replaces a participant's rally links atomically: delete all, recreate from `rallyIds`. */
async function replaceRallyLinks(
  context: GraphQLContext,
  participantId: string,
  rallyIds: string[]
): Promise<void> {
  await context.prisma.$transaction([
    context.prisma.participantRally.deleteMany({ where: { participantId } }),
    ...rallyIds.map(rallyId =>
      context.prisma.participantRally.create({
        data: { participantId, rallyId },
      })
    ),
  ]);
}

export const participantMutations = {
  createParticipant: async (
    _: unknown,
    { input }: { input: CreateParticipantInput },
    context: GraphQLContext
  ) => {
    checkPermission(context, 'content:create');
    const tenantId = context.tenant?.id ?? context.user?.tenantId;
    if (!tenantId) throw new AppError('Tenant not found', ErrorType.TENANT_ERROR, 400);

    const rallyIds = input.rallyIds ?? [];
    await assertRallyIdsBelongToTenant(context, tenantId, rallyIds);

    const count = await context.prisma.participant.count({ where: { tenantId } });
    const slug = await uniqueSlug(
      context,
      tenantId,
      input.slug || `${input.firstName} ${input.lastName}`
    );

    const participant = await context.prisma.participant.create({
      data: {
        tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        slug,
        honoraryTitle: input.honoraryTitle,
        photo: input.photo,
        country: input.country,
        bio: input.bio,
        displayOrder: input.displayOrder ?? count,
        isActive: input.isActive ?? true,
      },
    });

    if (rallyIds.length > 0) {
      await replaceRallyLinks(context, participant.id, rallyIds);
    }

    return context.prisma.participant.findUnique({
      where: { id: participant.id },
      include: PARTICIPANT_RALLY_INCLUDE,
    });
  },

  updateParticipant: async (
    _: unknown,
    { id, input }: { id: string; input: UpdateParticipantInput },
    context: GraphQLContext
  ) => {
    checkPermission(context, 'content:update');
    const tenantId = context.tenant?.id ?? context.user?.tenantId;
    const existing = await context.prisma.participant.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new AppError('Participant not found', ErrorType.NOT_FOUND, 404);

    if (input.rallyIds !== undefined) {
      await assertRallyIdsBelongToTenant(context, tenantId as string, input.rallyIds);
    }

    const slug =
      input.slug !== undefined
        ? await uniqueSlug(context, tenantId as string, input.slug, id)
        : undefined;

    await context.prisma.participant.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined && { firstName: input.firstName }),
        ...(input.lastName !== undefined && { lastName: input.lastName }),
        ...(input.photo !== undefined && { photo: input.photo }),
        ...(input.country !== undefined && { country: input.country }),
        ...(input.bio !== undefined && { bio: input.bio }),
        ...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.honoraryTitle !== undefined && { honoraryTitle: input.honoraryTitle }),
        ...(slug !== undefined && { slug }),
      },
    });

    if (input.rallyIds !== undefined) {
      await replaceRallyLinks(context, id, input.rallyIds);
    }

    return context.prisma.participant.findUnique({
      where: { id },
      include: PARTICIPANT_RALLY_INCLUDE,
    });
  },

  deleteParticipant: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
    checkPermission(context, 'content:delete');
    const tenantId = context.tenant?.id ?? context.user?.tenantId;
    const existing = await context.prisma.participant.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new AppError('Participant not found', ErrorType.NOT_FOUND, 404);

    await context.prisma.participant.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return true;
  },
};
