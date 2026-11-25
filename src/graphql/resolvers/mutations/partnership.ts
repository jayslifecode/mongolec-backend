import { assertPermission } from '@/utils/permissions';
export const partnershipMutations = {
  // Create park partnership (admin only)
  createParkPartnership: async (_: any, args: any, context: any) => {
    const { data } = args;

    assertPermission(context, 'partnership:create');

    try {
      // Create partnership
      const partnership = await context.prisma.parkPartnership.create({
        data: {
          ...data,
          tenantId: context.tenant?.id,
          partnershipStatus: data.partnershipStatus || 'PROSPECTIVE',
        },
        include: {
          rally: {
            select: {
              id: true,
              slug: true,
              title: true,
            },
          },
        },
      });

      return partnership;
    } catch (error) {
      console.error('Error creating park partnership:', error);
      throw new Error('Failed to create park partnership');
    }
  },

  // Update park partnership (admin only)
  updateParkPartnership: async (_: any, args: any, context: any) => {
    const { id, data } = args;

    assertPermission(context, 'partnership:update');

    try {
      // Verify partnership exists
      const existing = await context.prisma.parkPartnership.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Park partnership not found');
      }

      // Update partnership
      const partnership = await context.prisma.parkPartnership.update({
        where: { id },
        data,
        include: {
          rally: {
            select: {
              id: true,
              slug: true,
              title: true,
            },
          },
        },
      });

      return partnership;
    } catch (error) {
      if (error instanceof Error && error.message === 'Park partnership not found') throw error;
      console.error('Error updating park partnership:', error);
      throw new Error('Failed to update park partnership');
    }
  },

  // Update partnership status (admin only)
  changePartnershipStatus: async (_: any, args: any, context: any) => {
    const { id, status } = args;

    assertPermission(context, 'partnership:manage');

    try {
      // Verify partnership exists
      const existing = await context.prisma.parkPartnership.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Park partnership not found');
      }

      // Update status
      const partnership = await context.prisma.parkPartnership.update({
        where: { id },
        data: { partnershipStatus: status },
        include: {
          rally: {
            select: {
              id: true,
              slug: true,
              title: true,
            },
          },
        },
      });

      return partnership;
    } catch (error) {
      if (error instanceof Error && error.message === 'Park partnership not found') throw error;
      console.error('Error updating partnership status:', error);
      throw new Error('Failed to update partnership status');
    }
  },

  // Delete park partnership (soft delete, admin only)
  deleteParkPartnership: async (_: any, args: any, context: any) => {
    const { id } = args;

    assertPermission(context, 'partnership:delete');

    try {
      // Verify partnership exists
      const existing = await context.prisma.parkPartnership.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Park partnership not found');
      }

      // Soft delete
      await context.prisma.parkPartnership.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        message: 'Park partnership deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Park partnership not found') throw error;
      console.error('Error deleting park partnership:', error);
      throw new Error('Failed to delete park partnership');
    }
  },
};
