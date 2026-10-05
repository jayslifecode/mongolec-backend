import { Prisma } from '@prisma/client';

const STORY_INCLUDE = {
  rally: {
    select: {
      id: true,
      slug: true,
      title: true,
      startDate: true,
      endDate: true,
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
  tenant: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
};

export const storyQueries = {
  getStories: async (_: any, args: any, context: any) => {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      rallyId,
      search,
      orderBy = 'createdAt',
      orderDirection = 'desc',
    } = args;

    try {
      const where: Prisma.StoryWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
        ...(status && { status }),
        ...(type && { type }),
        ...(rallyId && { rallyId }),
        ...(search && {
          OR: [
            { slug: { contains: search, mode: 'insensitive' } },
            { featuredImage: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const [stories, total] = await Promise.all([
        context.prisma.story.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { [orderBy]: orderDirection },
          include: STORY_INCLUDE,
        }),
        context.prisma.story.count({ where }),
      ]);

      return {
        stories,
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
      console.error('Error fetching stories:', error);
      throw new Error('Failed to fetch stories');
    }
  },

  getStory: async (_: any, args: any, context: any) => {
    const { slug, id } = args;

    if (!slug && !id) {
      throw new Error('Either slug or id must be provided');
    }

    try {
      const canViewUnpublished = Boolean(context.user);

      const story = await context.prisma.story.findFirst({
        where: {
          tenantId: context.tenant?.id,
          deletedAt: null,
          ...(slug && { slug }),
          ...(id && { id }),
          ...(canViewUnpublished ? {} : { status: 'PUBLISHED' }),
        },
        include: {
          rally: {
            select: {
              id: true,
              slug: true,
              title: true,
              startDate: true,
              endDate: true,
            },
          },
          tenant: true,
        },
      });

      if (!story) {
        throw new Error('Story not found');
      }

      return story;
    } catch (error) {
      if (error instanceof Error && error.message === 'Story not found') throw error;
      console.error('Error fetching story:', error);
      throw new Error('Failed to fetch story');
    }
  },

  getPublishedStories: async (_: any, args: any, context: any) => {
    const { page = 1, limit = 20, type, rallyId } = args;

    try {
      const where: Prisma.StoryWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
        status: 'PUBLISHED',
        ...(type && { type }),
        ...(rallyId && { rallyId }),
      };

      const [stories, total] = await Promise.all([
        context.prisma.story.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { publishedAt: 'desc' },
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
        context.prisma.story.count({ where }),
      ]);

      return {
        stories,
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
      console.error('Error fetching published stories:', error);
      throw new Error('Failed to fetch published stories');
    }
  },

  getFeaturedStories: async (_: any, args: any, context: any) => {
    const { limit = 6 } = args;

    try {
      return await context.prisma.story.findMany({
        where: {
          tenantId: context.tenant?.id,
          deletedAt: null,
          status: 'PUBLISHED',
          featured: true,
        },
        take: limit,
        orderBy: { publishedAt: 'desc' },
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
    } catch (error) {
      console.error('Error fetching featured stories:', error);
      throw new Error('Failed to fetch featured stories');
    }
  },

  getRangerProfiles: async (_: any, _args: any, context: any) => {
    try {
      return await context.prisma.story.findMany({
        where: {
          tenantId: context.tenant?.id,
          deletedAt: null,
          status: 'PUBLISHED',
          type: 'RANGER_PROFILE',
        },
        orderBy: [{ displayOrder: 'asc' }, { publishedAt: 'desc' }],
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
    } catch (error) {
      console.error('Error fetching ranger profiles:', error);
      throw new Error('Failed to fetch ranger profiles');
    }
  },

  getRiderProfiles: async (_: any, _args: any, context: any) => {
    try {
      return await context.prisma.story.findMany({
        where: {
          tenantId: context.tenant?.id,
          deletedAt: null,
          status: 'PUBLISHED',
          type: 'RIDER_PROFILE',
        },
        orderBy: [{ displayOrder: 'asc' }, { publishedAt: 'desc' }],
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
    } catch (error) {
      console.error('Error fetching rider profiles:', error);
      throw new Error('Failed to fetch rider profiles');
    }
  },

  getImpactStories: async (_: any, args: any, context: any) => {
    const { page = 1, limit = 20 } = args;

    try {
      const where: Prisma.StoryWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
        status: 'PUBLISHED',
        type: 'IMPACT',
      };

      const [stories, total] = await Promise.all([
        context.prisma.story.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { publishedAt: 'desc' },
          include: {
            rally: {
              select: {
                id: true,
                slug: true,
                title: true,
              },
            },
          },
        }),
        context.prisma.story.count({ where }),
      ]);

      return {
        stories,
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
      console.error('Error fetching impact stories:', error);
      throw new Error('Failed to fetch impact stories');
    }
  },

  getDraftStories: async (_: any, args: any, context: any) => {
    const { page = 1, limit = 20 } = args;

    if (!context.user) {
      throw new Error('Authentication required');
    }

    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'story' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: story:manage required');
    }

    try {
      const where: Prisma.StoryWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
        status: 'DRAFT',
      };

      const [stories, total] = await Promise.all([
        context.prisma.story.findMany({
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
              },
            },
          },
        }),
        context.prisma.story.count({ where }),
      ]);

      return {
        stories,
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
      console.error('Error fetching draft stories:', error);
      throw new Error('Failed to fetch draft stories');
    }
  },

  getStoryStats: async (_: any, args: any, context: any) => {
    const { rallyId } = args;

    if (!context.user) {
      throw new Error('Authentication required');
    }

    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'story' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: story:manage required');
    }

    try {
      const where: Prisma.StoryWhereInput = {
        tenantId: context.tenant?.id,
        deletedAt: null,
        ...(rallyId && { rallyId }),
      };

      const [
        totalStories,
        publishedStories,
        draftStories,
        featuredStories,
        impactStories,
        riderStories,
        rallyStories,
      ] = await Promise.all([
        context.prisma.story.count({ where }),
        context.prisma.story.count({ where: { ...where, status: 'PUBLISHED' } }),
        context.prisma.story.count({ where: { ...where, status: 'DRAFT' } }),
        context.prisma.story.count({ where: { ...where, featured: true } }),
        context.prisma.story.count({ where: { ...where, type: 'IMPACT' } }),
        context.prisma.story.count({ where: { ...where, type: 'RIDER_PROFILE' } }),
        context.prisma.story.count({ where: { ...where, type: 'TESTIMONIAL' } }),
      ]);

      return {
        totalStories,
        publishedStories,
        draftStories,
        featuredStories,
        impactStories,
        riderStories,
        rallyStories,
      };
    } catch (error) {
      console.error('Error fetching story stats:', error);
      throw new Error('Failed to fetch story stats');
    }
  },

  getRelatedStories: async (_: any, args: any, context: any) => {
    const { storyId } = args;

    try {
      const story = await context.prisma.story.findFirst({
        where: { id: storyId, tenantId: context.tenant?.id, deletedAt: null },
        select: { type: true, rallyId: true, tags: true },
      });

      if (!story) return [];

      return context.prisma.story.findMany({
        where: {
          tenantId: context.tenant?.id,
          deletedAt: null,
          status: 'PUBLISHED',
          id: { not: storyId },
          OR: [{ type: story.type }, ...(story.rallyId ? [{ rallyId: story.rallyId }] : [])],
        },
        take: 4,
        orderBy: { publishedAt: 'desc' },
        include: {
          rally: { select: { id: true, slug: true, title: true } },
        },
      });
    } catch (error) {
      console.error('Error fetching related stories:', error);
      throw new Error('Failed to fetch related stories');
    }
  },
};
