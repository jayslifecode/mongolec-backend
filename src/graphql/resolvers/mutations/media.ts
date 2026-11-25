import { assertPermission } from '@/utils/permissions';
export const mediaMutations = {
  // Create media (admin only)
  createRallyMedia: async (_: any, args: any, context: any) => {
    const { data } = args;

    assertPermission(context, 'media:create');

    try {
      // Get max display order for this rally
      const maxOrder = await context.prisma.rallyMedia.findFirst({
        where: {
          rallyId: data.rallyId,
          tenantId: context.tenant?.id,
          deletedAt: null,
        },
        orderBy: { displayOrder: 'desc' },
        select: { displayOrder: true },
      });

      const displayOrder =
        data.displayOrder !== undefined ? data.displayOrder : (maxOrder?.displayOrder || 0) + 1;

      // Create media
      const media = await context.prisma.rallyMedia.create({
        data: {
          ...data,
          tenantId: context.tenant?.id,
          displayOrder,
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

      return media;
    } catch (error) {
      console.error('Error creating media:', error);
      throw new Error('Failed to create media');
    }
  },

  // Update media (admin only)
  updateRallyMedia: async (_: any, args: any, context: any) => {
    const { id, data } = args;

    assertPermission(context, 'media:update');

    try {
      // Verify media exists
      const existing = await context.prisma.rallyMedia.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Media not found');
      }

      // Update media
      const media = await context.prisma.rallyMedia.update({
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

      return media;
    } catch (error) {
      if (error instanceof Error && error.message === 'Media not found') throw error;
      console.error('Error updating media:', error);
      throw new Error('Failed to update media');
    }
  },

  // Delete media (soft delete, admin only)
  deleteRallyMedia: async (_: any, args: any, context: any) => {
    const { id } = args;

    assertPermission(context, 'media:delete');

    try {
      // Verify media exists
      const existing = await context.prisma.rallyMedia.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Media not found');
      }

      // Soft delete
      await context.prisma.rallyMedia.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        message: 'Media deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Media not found') throw error;
      console.error('Error deleting media:', error);
      throw new Error('Failed to delete media');
    }
  },

  // Reorder media (admin only)
  reorderRallyMedia: async (_: any, args: any, context: any) => {
    const { rallyId, mediaIds } = args;

    assertPermission(context, 'media:update');

    try {
      // Update display order for each media item
      const updatePromises = mediaIds.map((id: string, index: number) =>
        context.prisma.rallyMedia.updateMany({
          where: {
            id,
            rallyId,
            tenantId: context.tenant?.id,
            deletedAt: null,
          },
          data: { displayOrder: index },
        })
      );

      await Promise.all(updatePromises);

      // Return updated media list
      const media = await context.prisma.rallyMedia.findMany({
        where: {
          rallyId,
          tenantId: context.tenant?.id,
          deletedAt: null,
        },
        orderBy: { displayOrder: 'asc' },
      });

      return media;
    } catch (error) {
      console.error('Error reordering media:', error);
      throw new Error('Failed to reorder media');
    }
  },
};
