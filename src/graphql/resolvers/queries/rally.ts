import { Prisma } from '@prisma/client';

/** Drafts are work in progress in the admin; visitors never see them. */
const HIDE_DRAFTS: Prisma.RallyWhereInput = { status: { not: 'DRAFT' } };

function emptyPage(page: number, limit: number) {
  return {
    rallies: [],
    pagination: {
      total: 0,
      totalPages: 0,
      currentPage: page,
      perPage: limit,
      hasNextPage: false,
      hasPreviousPage: page > 1,
    },
  };
}

export const rallyQueries = {
  // Get all rallies with pagination and filters
  getRallies: async (_: any, args: any, context: any) => {
    const {
      page = 1,
      limit = 20,
      status,
      search: _search, // not yet implemented — JSON field search needs raw SQL
      orderBy = 'createdAt',
      orderDirection = 'desc',
      tenantId: tenantIdArg,
      isFeatured,
    } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      // Build where clause
      const tenantFilter = isSuperAdmin
        ? tenantIdArg
          ? { tenantId: tenantIdArg }
          : {}
        : { tenantId: context.tenant?.id };

      const where: Prisma.RallyWhereInput = {
        ...tenantFilter,
        deletedAt: null,
        ...(status ? { status } : !context.user && HIDE_DRAFTS),
        ...(typeof isFeatured === 'boolean' && { isFeatured }),
      };
      // A visitor asking for drafts by status still gets none.
      if (!context.user && status === 'DRAFT') return emptyPage(page, limit);

      // Note: JSON field search would need to use raw SQL or a different approach
      // For now, we'll skip searching JSON fields

      const [rallies, total] = await Promise.all([
        context.prisma.rally.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { [orderBy]: orderDirection },
          include: {
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            updatedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            _count: {
              select: {
                applications: true,
                stories: true,
              },
            },
          },
        }),
        context.prisma.rally.count({ where }),
      ]);

      return {
        rallies,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          perPage: limit,
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      console.error('Error fetching rallies:', error);
      throw new Error('Failed to fetch rallies');
    }
  },

  // Get single rally by slug or ID
  getRally: async (_: any, args: any, context: any) => {
    const { slug, id } = args;

    if (!slug && !id) {
      throw new Error('Either slug or id must be provided');
    }

    try {
      const rally = await context.prisma.rally.findFirst({
        where: {
          tenantId: context.tenant?.id,
          deletedAt: null,
          ...(slug && { slug }),
          ...(id && { id }),
          ...(!context.user && HIDE_DRAFTS),
        },
        include: {
          tenant: true,
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          applications: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          media: {
            where: { deletedAt: null },
            orderBy: { displayOrder: 'asc' },
          },
          stories: {
            where: { deletedAt: null, status: 'PUBLISHED' },
            orderBy: { createdAt: 'desc' },
            take: 6,
          },
        },
      });

      if (!rally) {
        throw new Error('Rally not found');
      }

      return rally;
    } catch (error) {
      if (error instanceof Error && error.message === 'Rally not found') throw error;
      console.error('Error fetching rally:', error);
      throw new Error('Failed to fetch rally');
    }
  },

  // Get upcoming rallies
  getUpcomingRallies: async (_: any, args: any, context: any) => {
    const { page = 1, limit = 20 } = args;

    try {
      const where: Prisma.RallyWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
        status: { in: ['UPCOMING', 'ONGOING'] },
      };

      const [rallies, total] = await Promise.all([
        context.prisma.rally.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { startDate: 'asc' },
          include: {
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            _count: {
              select: {
                applications: true,
              },
            },
          },
        }),
        context.prisma.rally.count({ where }),
      ]);

      return {
        rallies,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          perPage: limit,
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      console.error('Error fetching upcoming rallies:', error);
      throw new Error('Failed to fetch upcoming rallies');
    }
  },

  // Get past rallies
  getPastRallies: async (_: any, args: any, context: any) => {
    const { page = 1, limit = 20 } = args;

    try {
      const where: Prisma.RallyWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
        status: 'COMPLETED',
      };

      const [rallies, total] = await Promise.all([
        context.prisma.rally.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { startDate: 'desc' },
          include: {
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            _count: {
              select: {
                applications: true,
                stories: true,
              },
            },
          },
        }),
        context.prisma.rally.count({ where }),
      ]);

      return {
        rallies,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          perPage: limit,
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      console.error('Error fetching past rallies:', error);
      throw new Error('Failed to fetch past rallies');
    }
  },

  // The rally featured on the website's home hero. Public, so drafts are never returned, and
  // without a known organisation there is nothing to answer (no cross-tenant fallback).
  getFeaturedRally: async (_: any, _args: any, context: any) => {
    const tenantId = context.tenant?.id;
    if (!tenantId) return null;
    return context.prisma.rally.findFirst({
      where: { tenantId, deletedAt: null, isFeatured: true, ...HIDE_DRAFTS },
    });
  },

  // Get recruiting rallies (accepting applications)
  getRecruitingRallies: async (_: any, _args: any, context: any) => {
    try {
      return await context.prisma.rally.findMany({
        where: {
          tenantId: context.tenant?.id,
          deletedAt: null,
          isRecruiting: true,
          status: { in: ['UPCOMING', 'ONGOING'] },
          isPlaceholder: false,
          OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: new Date() } }],
        },
        orderBy: { startDate: 'asc' },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          _count: {
            select: {
              applications: true,
            },
          },
        },
      });
    } catch (error) {
      console.error('Error fetching recruiting rallies:', error);
      throw new Error('Failed to fetch recruiting rallies');
    }
  },
};
