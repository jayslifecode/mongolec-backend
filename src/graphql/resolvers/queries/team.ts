import { checkPermission } from '@/auth';
import { type GraphQLContext } from '@/types';
import { hasPermission } from '@/utils/permissions';

export const teamQueries = {
  getTeamMembers: async (_: unknown, __: unknown, context: GraphQLContext) => {
    const tenantId = context.tenant?.id ?? context.user?.tenantId;
    if (!tenantId) return [];
    // The public site lists active members; signed-in editors also see inactive ones so they
    // can edit and re-activate them.
    const canSeeInactive = hasPermission(context.user, 'content:read');
    return context.prisma.teamMember.findMany({
      where: { tenantId, deletedAt: null, ...(!canSeeInactive && { isActive: true }) },
      orderBy: { displayOrder: 'asc' },
    });
  },

  getContactMessages: async (
    _: unknown,
    { page = 1, limit = 20, status }: { page?: number; limit?: number; status?: string },
    context: GraphQLContext
  ) => {
    checkPermission(context, 'content:read');
    const isSuperAdmin = context.user?.roles?.includes('super_admin');
    const tenantId = context.user?.tenantId;
    if (!isSuperAdmin && !tenantId) {
      return { items: [], total: 0, page, limit };
    }
    const safePage = Math.max(page || 1, 1);
    const safeLimit = Math.min(Math.max(limit || 20, 1), 100);
    const where = {
      ...(isSuperAdmin ? {} : { tenantId }),
      ...(status && { status: status as never }),
    };
    const [items, total] = await Promise.all([
      context.prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      context.prisma.contactMessage.count({ where }),
    ]);
    return { items, total, page: safePage, limit: safeLimit };
  },

  getContactMessage: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
    checkPermission(context, 'content:read');
    const isSuperAdmin = context.user?.roles?.includes('super_admin');
    const tenantId = context.user?.tenantId;
    if (!isSuperAdmin && !tenantId) return null;
    return context.prisma.contactMessage.findFirst({
      where: { id, ...(isSuperAdmin ? {} : { tenantId }) },
    });
  },
};
