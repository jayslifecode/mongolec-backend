import { Prisma } from '@prisma/client';
import { assertPermission } from '@/utils/permissions';

export const nominationQueries = {
  // Get all nominations with filters
  getNominations: async (_: any, args: any, context: any) => {
    assertPermission(context, 'nomination:manage');
    const { page = 1, limit = 20, status, country, search, orderBy = 'createdAt', orderDirection = 'desc' } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const where: Prisma.ParkNominationWhereInput = {
        ...(!isSuperAdmin && { tenantId: context.tenant?.id }),
        deletedAt: null,
        ...(status && { status }),
        ...(country && { country: { contains: country, mode: 'insensitive' } }),
        ...(search && {
          OR: [
            { partnerOrganizationName: { contains: search, mode: 'insensitive' } },
            { partnerContactEmail: { contains: search, mode: 'insensitive' } },
            { parkContactEmail: { contains: search, mode: 'insensitive' } },
            { country: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const [nominations, total] = await Promise.all([
        context.prisma.parkNomination.findMany({
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
          },
        }),
        context.prisma.parkNomination.count({ where }),
      ]);

      return {
        nominations,
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
      console.error('Error fetching nominations:', error);
      throw new Error('Failed to fetch nominations');
    }
  },

  // Get single nomination by ID
  getNomination: async (_: any, args: any, context: any) => {
    assertPermission(context, 'nomination:manage');
    const { id } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const nomination = await context.prisma.parkNomination.findFirst({
        where: { id, ...(!isSuperAdmin && { tenantId: context.tenant?.id }), deletedAt: null },
        include: {
          tenant: true,
        },
      });

      if (!nomination) {
        throw new Error('Nomination not found');
      }

      return nomination;
    } catch (error) {
      if (error instanceof Error && error.message === 'Nomination not found') throw error;
      console.error('Error fetching nomination:', error);
      throw new Error('Failed to fetch nomination');
    }
  },

  // Get pending nominations
  getPendingNominations: async (_: any, args: any, context: any) => {
    assertPermission(context, 'nomination:manage');
    const { page = 1, limit = 20 } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const where: Prisma.ParkNominationWhereInput = {
        ...(!isSuperAdmin && { tenantId: context.tenant?.id }),
        deletedAt: null,
        status: 'PENDING',
      };

      const [nominations, total] = await Promise.all([
        context.prisma.parkNomination.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'asc' },
        }),
        context.prisma.parkNomination.count({ where }),
      ]);

      return {
        nominations,
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
      console.error('Error fetching pending nominations:', error);
      throw new Error('Failed to fetch pending nominations');
    }
  },

  // Get approved nominations
  getApprovedNominations: async (_: any, args: any, context: any) => {
    assertPermission(context, 'nomination:manage');
    const { page = 1, limit = 20 } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const where: Prisma.ParkNominationWhereInput = {
        ...(!isSuperAdmin && { tenantId: context.tenant?.id }),
        deletedAt: null,
        status: 'APPROVED',
      };

      const [nominations, total] = await Promise.all([
        context.prisma.parkNomination.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        context.prisma.parkNomination.count({ where }),
      ]);

      return {
        nominations,
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
      console.error('Error fetching approved nominations:', error);
      throw new Error('Failed to fetch approved nominations');
    }
  },

  // Get nomination statistics
  getNominationStats: async (_: any, _args: any, context: any) => {
    assertPermission(context, 'nomination:manage');
    const isSuperAdmin = context.user?.roles?.includes('super_admin');
    try {
      const where: Prisma.ParkNominationWhereInput = {
        ...(!isSuperAdmin && { tenantId: context.tenant?.id }),
        deletedAt: null,
      };

      const [total, pending, underReview, approved, rejected, selected, notSelected] = await Promise.all([
        context.prisma.parkNomination.count({ where }),
        context.prisma.parkNomination.count({ where: { ...where, status: 'PENDING' } }),
        context.prisma.parkNomination.count({ where: { ...where, status: 'UNDER_REVIEW' } }),
        context.prisma.parkNomination.count({ where: { ...where, status: 'APPROVED' } }),
        context.prisma.parkNomination.count({ where: { ...where, status: 'REJECTED' } }),
        context.prisma.parkNomination.count({ where: { ...where, status: 'SELECTED' } }),
        context.prisma.parkNomination.count({ where: { ...where, status: 'NOT_SELECTED' } }),
      ]);

      return { total, pending, underReview, approved, rejected, selected, notSelected };
    } catch (error) {
      console.error('Error fetching nomination stats:', error);
      throw new Error('Failed to fetch nomination stats');
    }
  },

  // Check if email has already submitted a nomination for this tenant
  checkHasNominated: async (_: any, args: any, context: any) => {
    const { email } = args;

    try {
      const nomination = await context.prisma.parkNomination.findFirst({
        where: {
          parkContactEmail: email.toLowerCase(),
          tenantId: context.tenant?.id,
          deletedAt: null,
        },
      });

      return !!nomination;
    } catch (error) {
      console.error('Error checking nomination:', error);
      return false;
    }
  },
};
