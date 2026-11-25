import { assertPermission } from '@/utils/permissions';
export const storyMutations = {
  // Create story (admin only)
  createStory: async (_: any, args: any, context: any) => {
    const { data } = args;

    assertPermission(context, 'story:create');

    try {
      // Check if slug already exists
      if (data.slug) {
        const existing = await context.prisma.story.findUnique({
          where: {
            slug_tenantId: {
              slug: data.slug,
              tenantId: context.tenant?.id,
            },
          },
        });

        if (existing) {
          throw new Error('Story with this slug already exists');
        }
      }

      // Create story
      const story = await context.prisma.story.create({
        data: {
          ...data,
          tenantId: context.tenant?.id,
          createdById: context.user.id,
          status: data.status || 'DRAFT',
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

      return story;
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) throw error;
      console.error('Error creating story:', error);
      throw new Error('Failed to create story');
    }
  },

  // Update story (admin only)
  updateStory: async (_: any, args: any, context: any) => {
    const { id, data } = args;

    assertPermission(context, 'story:update');

    try {
      // Verify story exists
      const existing = await context.prisma.story.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Story not found');
      }

      // Check if new slug conflicts
      if (data.slug && data.slug !== existing.slug) {
        const slugConflict = await context.prisma.story.findUnique({
          where: {
            slug_tenantId: {
              slug: data.slug,
              tenantId: context.tenant?.id,
            },
          },
        });

        if (slugConflict) {
          throw new Error('Story with this slug already exists');
        }
      }

      // Update story
      const story = await context.prisma.story.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
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

      return story;
    } catch (error) {
      if (error instanceof Error && error.message === 'Story not found') throw error;
      if (error instanceof Error && error.message.includes('already exists')) throw error;
      console.error('Error updating story:', error);
      throw new Error('Failed to update story');
    }
  },

  // Publish story (admin only)
  publishStory: async (_: any, args: any, context: any) => {
    const { id } = args;

    assertPermission(context, 'story:publish');

    try {
      // Verify story exists
      const existing = await context.prisma.story.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Story not found');
      }

      // Publish story
      const story = await context.prisma.story.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          updatedAt: new Date(),
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

      return story;
    } catch (error) {
      if (error instanceof Error && error.message === 'Story not found') throw error;
      console.error('Error publishing story:', error);
      throw new Error('Failed to publish story');
    }
  },

  // Unpublish story (admin only)
  unpublishStory: async (_: any, args: any, context: any) => {
    const { id } = args;

    assertPermission(context, 'story:publish');

    try {
      // Verify story exists
      const existing = await context.prisma.story.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Story not found');
      }

      // Unpublish story
      const story = await context.prisma.story.update({
        where: { id },
        data: {
          status: 'DRAFT',
          updatedAt: new Date(),
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

      return story;
    } catch (error) {
      if (error instanceof Error && error.message === 'Story not found') throw error;
      console.error('Error unpublishing story:', error);
      throw new Error('Failed to unpublish story');
    }
  },

  // Toggle featured status (admin only)
  toggleStoryFeatured: async (_: any, args: any, context: any) => {
    const { id } = args;

    assertPermission(context, 'story:manage');

    try {
      // Verify story exists
      const existing = await context.prisma.story.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Story not found');
      }

      // Toggle featured
      const story = await context.prisma.story.update({
        where: { id },
        data: {
          featured: !existing.featured,
          updatedAt: new Date(),
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

      return story;
    } catch (error) {
      if (error instanceof Error && error.message === 'Story not found') throw error;
      console.error('Error toggling story featured:', error);
      throw new Error('Failed to toggle story featured status');
    }
  },

  // Delete story (soft delete, admin only)
  deleteStory: async (_: any, args: any, context: any) => {
    const { id } = args;

    assertPermission(context, 'story:delete');

    try {
      // Verify story exists
      const existing = await context.prisma.story.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Story not found');
      }

      // Soft delete
      await context.prisma.story.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        message: 'Story deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Story not found') throw error;
      console.error('Error deleting story:', error);
      throw new Error('Failed to delete story');
    }
  },
};
