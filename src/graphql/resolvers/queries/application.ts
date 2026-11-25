import { assertCanManageApplications } from '@/utils/application-access';
import { Prisma } from '@prisma/client';

export const applicationQueries = {
  // Get all applications with filters
  getApplications: async (_: any, args: any, context: any) => {
    assertCanManageApplications(context);
    const { page = 1, limit = 20, status, rallyId, search, orderBy = 'createdAt', orderDirection = 'desc' } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const where: Prisma.RallyApplicationWhereInput = {
        ...(!isSuperAdmin && { tenantId: context.tenant?.id }),
        deletedAt: null,
        ...(status && { status }),
        ...(rallyId && { rallyId }),
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const [applications, total] = await Promise.all([
        context.prisma.rallyApplication.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { [orderBy]: orderDirection },
          include: {
            rally: {
              select: {
                id: true,
                slug: true,
                title: true,
                startDate: true,
                endDate: true,
                location: true,
                status: true,
              },
            },
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        }),
        context.prisma.rallyApplication.count({ where }),
      ]);

      return {
        applications,
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
      console.error('Error fetching applications:', error);
      throw new Error('Failed to fetch applications');
    }
  },

  // Get single application by ID
  getApplication: async (_: any, args: any, context: any) => {
    assertCanManageApplications(context);
    const { id } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const application = await context.prisma.rallyApplication.findFirst({
        where: { id, ...(!isSuperAdmin && { tenantId: context.tenant?.id }), deletedAt: null },
        include: {
          rally: {
            select: {
              id: true,
              slug: true,
              title: true,
              startDate: true,
              endDate: true,
              location: true,
              cost: true,
              status: true,
            },
          },
          tenant: true,
        },
      });

      if (!application) {
        throw new Error('Application not found');
      }

      return application;
    } catch (error) {
      if (error instanceof Error && error.message === 'Application not found') throw error;
      console.error('Error fetching application:', error);
      throw new Error('Failed to fetch application');
    }
  },

  // Get pending applications
  getPendingApplications: async (_: any, args: any, context: any) => {
    assertCanManageApplications(context);
    const { page = 1, limit = 20 } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const where: Prisma.RallyApplicationWhereInput = {
        ...(!isSuperAdmin && { tenantId: context.tenant?.id }),
        deletedAt: null,
        status: 'PENDING',
      };

      const [applications, total] = await Promise.all([
        context.prisma.rallyApplication.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'asc' },
          include: {
            rally: {
              select: {
                id: true,
                slug: true,
                title: true,
                startDate: true,
                status: true,
              },
            },
          },
        }),
        context.prisma.rallyApplication.count({ where }),
      ]);

      return {
        applications,
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
      console.error('Error fetching pending applications:', error);
      throw new Error('Failed to fetch pending applications');
    }
  },

  // Get approved applications
  getApprovedApplications: async (_: any, args: any, context: any) => {
    assertCanManageApplications(context);
    const { page = 1, limit = 20, rallyId } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const where: Prisma.RallyApplicationWhereInput = {
        ...(!isSuperAdmin && { tenantId: context.tenant?.id }),
        deletedAt: null,
        status: { in: ['APPROVED', 'CONFIRMED'] },
        ...(rallyId && { rallyId }),
      };

      const [applications, total] = await Promise.all([
        context.prisma.rallyApplication.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            rally: {
              select: {
                id: true,
                slug: true,
                title: true,
                startDate: true,
              },
            },
          },
        }),
        context.prisma.rallyApplication.count({ where }),
      ]);

      return {
        applications,
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
      console.error('Error fetching approved applications:', error);
      throw new Error('Failed to fetch approved applications');
    }
  },

  // Get application statistics
  getApplicationStats: async (_: any, args: any, context: any) => {
    assertCanManageApplications(context);
    const { rallyId } = args;
    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      const where: Prisma.RallyApplicationWhereInput = {
        ...(!isSuperAdmin && { tenantId: context.tenant?.id }),
        deletedAt: null,
        ...(rallyId && { rallyId }),
      };

      const [
        totalApplications,
        pendingApplications,
        approvedApplications,
        rejectedApplications,
        waitlistedApplications,
        confirmedApplications,
        riders,
        supporters,
        totalRaising,
      ] = await Promise.all([
        context.prisma.rallyApplication.count({ where }),
        context.prisma.rallyApplication.count({ where: { ...where, status: 'PENDING' } }),
        context.prisma.rallyApplication.count({ where: { ...where, status: 'APPROVED' } }),
        context.prisma.rallyApplication.count({ where: { ...where, status: 'REJECTED' } }),
        context.prisma.rallyApplication.count({ where: { ...where, status: 'WAITLIST' } }),
        context.prisma.rallyApplication.count({ where: { ...where, status: 'CONFIRMED' } }),
        context.prisma.rallyApplication.count({ where: { ...where, isRider: true } }),
        context.prisma.rallyApplication.count({ where: { ...where, isRider: false } }),
        context.prisma.rallyApplication.aggregate({
          where: { ...where, fullyPaid: true },
          _sum: { totalAmount: true },
        }),
      ]);

      const approvalRate = totalApplications > 0
        ? Math.round(((approvedApplications + confirmedApplications) / totalApplications) * 100)
        : 0;

      return {
        totalApplications,
        pendingApplications,
        approvedApplications,
        rejectedApplications,
        waitlistedApplications,
        confirmedApplications,
        riderCount: riders,
        supporterCount: supporters,
        totalRaising: totalRaising._sum.totalAmount || 0,
        approvalRate,
      };
    } catch (error) {
      console.error('Error fetching application stats:', error);
      throw new Error('Failed to fetch application stats');
    }
  },

  // Check if email has already applied to a rally
  checkHasApplied: async (_: any, args: any, context: any) => {
    assertCanManageApplications(context);
    const { rallyId, email } = args;

    try {
      const application = await context.prisma.rallyApplication.findFirst({
        where: {
          rallyId,
          email: email.toLowerCase(),
          tenantId: context.tenant?.id,
          deletedAt: null,
        },
      });

      return !!application;
    } catch (error) {
      console.error('Error checking application:', error);
      return false;
    }
  },
};
