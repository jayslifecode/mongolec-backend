import { type GraphQLContext, AppError, ErrorType } from '@/types';
import { tierFor } from '@/config/rider-tiers';

/**
 * Nested rally selection used whenever a Participant's `rallies` field might be requested.
 * Eagerly included on list/detail queries so `Participant.rallies` (a field resolver in
 * `resolvers/index.ts`) never has to issue a per-participant query.
 */
export const PARTICIPANT_RALLY_INCLUDE = {
  rallies: {
    include: {
      rally: {
        select: {
          id: true,
          slug: true,
          title: true,
          startDate: true,
          endDate: true,
          heroImage: true,
          status: true,
          location: true,
          stories: { select: { slug: true, status: true } },
        },
      },
    },
  },
  _count: { select: { rallies: true } },
} as const;

export const participantQueries = {
  getParticipants: async (
    _: unknown,
    {
      limit = 20,
      page = 1,
      isActive,
      search,
      tier,
    }: {
      limit?: number;
      page?: number;
      isActive?: boolean;
      search?: string;
      tier?: string;
    },
    context: GraphQLContext
  ) => {
    // Public read — no auth required
    const tenantId = context.tenant?.id ?? context.user?.tenantId;
    const safePage = Math.max(page || 1, 1);
    const safeLimit = Math.min(Math.max(limit || 20, 1), 500);
    const empty = {
      participants: [],
      pagination: {
        total: 0,
        totalPages: 0,
        currentPage: safePage,
        perPage: safeLimit,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
    if (!tenantId) return empty;

    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      ...(isActive !== undefined && { isActive }),
    };
    if (search && search.trim()) {
      where.OR = [
        { firstName: { contains: search.trim(), mode: 'insensitive' } },
        { lastName: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    // rallyCount/tier are computed from `_count`, not stored, so tier can't be filtered at the
    // DB level. The tenant's full roster is small (bounded, currently ~200 rows), so we fetch
    // it in one query (no N+1), filter by tier in memory, then paginate so `pagination.total`
    // stays accurate for the tier-filtered set.
    const all = await context.prisma.participant.findMany({
      where,
      include: PARTICIPANT_RALLY_INCLUDE,
      orderBy: { displayOrder: 'asc' },
    });

    const filtered = tier ? all.filter(p => tierFor(p._count.rallies) === tier) : all;

    const total = filtered.length;
    const totalPages = Math.ceil(total / safeLimit) || 0;
    const start = (safePage - 1) * safeLimit;
    const participants = filtered.slice(start, start + safeLimit);

    return {
      participants,
      pagination: {
        total,
        totalPages,
        currentPage: safePage,
        perPage: safeLimit,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
      },
    };
  },

  getParticipant: async (
    _: unknown,
    { slug, id }: { slug?: string; id?: string },
    context: GraphQLContext
  ) => {
    if (!slug && !id) {
      throw new AppError('Either slug or id must be provided', ErrorType.VALIDATION_ERROR, 400);
    }
    const tenantId = context.tenant?.id ?? context.user?.tenantId;
    if (!tenantId) return null;

    return context.prisma.participant.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        ...(slug ? { slug } : { id }),
      },
      include: PARTICIPANT_RALLY_INCLUDE,
    });
  },
};
