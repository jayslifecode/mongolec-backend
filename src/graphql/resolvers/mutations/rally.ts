import { assertPermission } from '@/utils/permissions';
import { AppError, ErrorType } from '@/types';

/** A rally cannot end before it starts. */
function assertDateOrder(startDate: Date, endDate: Date): void {
  if (endDate.getTime() < startDate.getTime()) {
    throw new AppError(
      'The end date must be on or after the start date.',
      ErrorType.VALIDATION_ERROR,
      400
    );
  }
}

export const rallyMutations = {
  // Create a new rally
  createRally: async (_: any, args: any, context: any) => {
    const { data } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    const hasPermission = context.user.permissions?.includes('rally:create');

    if (!hasPermission) {
      throw new Error('Permission denied: rally:create required');
    }

    const isSuperAdmin = context.user.roles?.includes('super_admin');
    const { tenantId: inputTenantId, ...rallyData } = data;
    const resolvedTenantId = isSuperAdmin && inputTenantId ? inputTenantId : context.tenant?.id;
    assertDateOrder(new Date(data.startDate), new Date(data.endDate));

    try {
      // Check if slug already exists
      const existing = await context.prisma.rally.findUnique({
        where: {
          slug_tenantId: {
            slug: data.slug,
            tenantId: resolvedTenantId,
          },
        },
      });

      if (existing) {
        throw new Error('Rally with this slug already exists');
      }

      // Calculate duration if not provided
      const startDate = new Date(data.startDate);
      const endDate = new Date(data.endDate);
      const duration =
        data.duration ||
        Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      // Create rally
      const rally = await context.prisma.rally.create({
        data: {
          ...rallyData,
          duration,
          tenantId: resolvedTenantId,
          createdById: context.user.id,
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
        },
      });

      return rally;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.message.includes('already exists')) throw error;
      console.error('Error creating rally:', error);
      throw new Error('Failed to create rally');
    }
  },

  // Update a rally
  updateRally: async (_: any, args: any, context: any) => {
    const { id, data } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    const hasPermission = context.user.permissions?.includes('rally:update');

    if (!hasPermission) {
      throw new Error('Permission denied: rally:update required');
    }

    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      // Verify rally exists and belongs to tenant
      const existing = await context.prisma.rally.findFirst({
        where: { id, deletedAt: null, ...(isSuperAdmin ? {} : { tenantId: context.tenant?.id }) },
      });

      if (!existing) {
        throw new Error('Rally not found');
      }

      // Check if new slug conflicts
      if (data.slug && data.slug !== existing.slug) {
        const slugConflict = await context.prisma.rally.findUnique({
          where: {
            slug_tenantId: {
              slug: data.slug,
              tenantId: context.tenant?.id,
            },
          },
        });

        if (slugConflict) {
          throw new Error('Rally with this slug already exists');
        }
      }

      // Calculate duration if dates changed
      let duration = data.duration;
      if (data.startDate || data.endDate) {
        const startDate = data.startDate ? new Date(data.startDate) : new Date(existing.startDate);
        const endDate = data.endDate ? new Date(data.endDate) : new Date(existing.endDate);
        assertDateOrder(startDate, endDate);
        duration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Update rally
      const rally = await context.prisma.rally.update({
        where: { id },
        data: {
          ...data,
          ...(duration && { duration }),
          updatedById: context.user.id,
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
        },
      });

      return rally;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (
        error instanceof Error &&
        (error.message === 'Rally not found' || error.message.includes('already exists'))
      ) {
        throw error;
      }
      console.error('Error updating rally:', error);
      throw new Error('Failed to update rally');
    }
  },

  // Delete a rally (soft delete)
  deleteRally: async (_: any, args: any, context: any) => {
    const { id } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    const hasPermission = context.user.permissions?.includes('rally:delete');

    if (!hasPermission) {
      throw new Error('Permission denied: rally:delete required');
    }

    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      // Verify rally exists
      const existing = await context.prisma.rally.findFirst({
        where: { id, deletedAt: null, ...(isSuperAdmin ? {} : { tenantId: context.tenant?.id }) },
      });

      if (!existing) {
        throw new Error('Rally not found');
      }

      // Soft delete
      await context.prisma.rally.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        message: 'Rally deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Rally not found') throw error;
      console.error('Error deleting rally:', error);
      throw new Error('Failed to delete rally');
    }
  },

  // Update rally status
  changeRallyStatus: async (_: any, args: any, context: any) => {
    const { id, status } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    const hasPermission = context.user.permissions?.includes('rally:update');

    if (!hasPermission) {
      throw new Error('Permission denied: rally:update required');
    }

    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      // Verify rally exists
      const existing = await context.prisma.rally.findFirst({
        where: { id, deletedAt: null, ...(isSuperAdmin ? {} : { tenantId: context.tenant?.id }) },
      });

      if (!existing) {
        throw new Error('Rally not found');
      }

      // Update status
      const rally = await context.prisma.rally.update({
        where: { id },
        data: {
          status,
          updatedById: context.user.id,
        },
      });

      return rally;
    } catch (error) {
      if (error instanceof Error && error.message === 'Rally not found') throw error;
      console.error('Error updating rally status:', error);
      throw new Error('Failed to update rally status');
    }
  },

  // Update participant count
  updateRallyParticipantCount: async (_: any, args: any, context: any) => {
    const { id, count } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    const hasPermission = context.user.permissions?.includes('rally:update');

    if (!hasPermission) {
      throw new Error('Permission denied: rally:update required');
    }

    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      // Verify rally exists
      const existing = await context.prisma.rally.findFirst({
        where: { id, deletedAt: null, ...(isSuperAdmin ? {} : { tenantId: context.tenant?.id }) },
      });

      if (!existing) {
        throw new Error('Rally not found');
      }

      // Update participant count
      const rally = await context.prisma.rally.update({
        where: { id },
        data: {
          currentParticipants: count,
          updatedById: context.user.id,
        },
      });

      return rally;
    } catch (error) {
      if (error instanceof Error && error.message === 'Rally not found') throw error;
      console.error('Error updating participant count:', error);
      throw new Error('Failed to update participant count');
    }
  },

  // Toggle recruiting status
  toggleRallyRecruiting: async (_: any, args: any, context: any) => {
    const { id } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    const hasPermission = context.user.permissions?.includes('rally:update');

    if (!hasPermission) {
      throw new Error('Permission denied: rally:update required');
    }

    const isSuperAdmin = context.user?.roles?.includes('super_admin');

    try {
      // Get current rally
      const rally = await context.prisma.rally.findFirst({
        where: { id, deletedAt: null, ...(isSuperAdmin ? {} : { tenantId: context.tenant?.id }) },
      });

      if (!rally) {
        throw new Error('Rally not found');
      }

      // Toggle recruiting
      const updated = await context.prisma.rally.update({
        where: { id },
        data: {
          isRecruiting: !rally.isRecruiting,
          updatedById: context.user.id,
        },
      });

      return updated;
    } catch (error) {
      if (error instanceof Error && error.message === 'Rally not found') throw error;
      console.error('Error toggling recruiting:', error);
      throw new Error('Failed to toggle recruiting status');
    }
  },

  // Change newsletter subscription status (admin only)
  changeSubscriptionStatus: async (_: any, args: any, context: any) => {
    const { email, status } = args;

    assertPermission(context, 'newsletter:manage');

    try {
      // Verify subscription exists
      const existing = await context.prisma.newsletterSubscription.findFirst({
        where: { email: email.toLowerCase(), tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Newsletter subscription not found');
      }

      // Update status
      const subscription = await context.prisma.newsletterSubscription.update({
        where: { id: existing.id },
        data: { status },
      });

      return subscription;
    } catch (error) {
      if (error instanceof Error && error.message === 'Newsletter subscription not found')
        throw error;
      console.error('Error changing subscription status:', error);
      throw new Error('Failed to change subscription status');
    }
  },
};
