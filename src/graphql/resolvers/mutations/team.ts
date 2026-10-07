import { checkPermission } from '@/auth';
import { AppError, ErrorType, type GraphQLContext } from '@/types';
import { assertSubmissionAllowed } from '@/middleware/submission-throttle';
import { sendEmail, getAdminNotifyEmail } from '@/libs/email';
import { adminContactNotificationEmail } from '@/libs/email-templates/contact';
import { createLogger } from '@/utils/logger';

const logger = createLogger('TEAM_MUTATIONS');

function getClientIp(context: GraphQLContext): string {
  return context.req?.ip || context.req?.socket?.remoteAddress || 'unknown';
}

export const teamMutations = {
  createTeamMember: async (
    _: unknown,
    {
      data,
    }: {
      data: {
        name: string;
        role: string;
        bio?: string;
        photo?: string;
        email?: string;
        linkedinUrl?: string;
        twitterUrl?: string;
        displayOrder?: number;
        isActive?: boolean;
        tenantId?: string;
      };
    },
    context: GraphQLContext
  ) => {
    checkPermission(context, 'content:create');
    const isSuperAdmin = context.user?.roles?.includes('super_admin');
    const tenantId = isSuperAdmin && data.tenantId ? data.tenantId : context.user?.tenantId;
    if (!tenantId) throw new Error('Tenant not found');
    const count = await context.prisma.teamMember.count({ where: { tenantId } });
    return context.prisma.teamMember.create({
      data: {
        tenantId,
        name: data.name,
        role: data.role,
        bio: data.bio,
        photo: data.photo,
        email: data.email,
        linkedinUrl: data.linkedinUrl,
        twitterUrl: data.twitterUrl,
        displayOrder: data.displayOrder ?? count,
        isActive: data.isActive ?? true,
      },
    });
  },

  updateTeamMember: async (
    _: unknown,
    {
      id,
      data,
    }: {
      id: string;
      data: {
        name?: string;
        role?: string;
        bio?: string;
        photo?: string;
        email?: string;
        linkedinUrl?: string;
        twitterUrl?: string;
        displayOrder?: number;
        isActive?: boolean;
      };
    },
    context: GraphQLContext
  ) => {
    checkPermission(context, 'content:update');
    const existing = await context.prisma.teamMember.findFirst({
      where: { id, tenantId: context.user?.tenantId },
    });
    if (!existing) throw new AppError('Team member not found', ErrorType.NOT_FOUND, 404);
    return context.prisma.teamMember.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.bio !== undefined && { bio: data.bio }),
        ...(data.photo !== undefined && { photo: data.photo }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.linkedinUrl !== undefined && { linkedinUrl: data.linkedinUrl }),
        ...(data.twitterUrl !== undefined && { twitterUrl: data.twitterUrl }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  },

  deleteTeamMember: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
    checkPermission(context, 'content:delete');
    const existing = await context.prisma.teamMember.findFirst({
      where: { id, tenantId: context.user?.tenantId },
    });
    if (!existing) throw new AppError('Team member not found', ErrorType.NOT_FOUND, 404);
    await context.prisma.teamMember.delete({ where: { id } });
    return { success: true, message: 'Team member deleted' };
  },

  reorderTeamMembers: async (_: unknown, { ids }: { ids: string[] }, context: GraphQLContext) => {
    checkPermission(context, 'content:update');
    const tenantId = context.user?.tenantId;
    if (!tenantId) throw new AppError('Tenant not found', ErrorType.TENANT_ERROR, 400);
    const existing = await context.prisma.teamMember.findMany({
      where: { id: { in: ids }, tenantId },
    });
    if (existing.length !== ids.length) {
      throw new AppError('Some team members not found', ErrorType.NOT_FOUND, 404);
    }
    await Promise.all(
      ids.map((id, index) =>
        context.prisma.teamMember.update({ where: { id }, data: { displayOrder: index } })
      )
    );
    return context.prisma.teamMember.findMany({
      where: { tenantId },
      orderBy: { displayOrder: 'asc' },
    });
  },

  submitContactMessage: async (
    _: unknown,
    {
      data,
    }: {
      data: { name: string; email: string; subject: string; message: string; honeypot?: string };
    },
    context: GraphQLContext
  ) => {
    // Honeypot: bots fill hidden fields. Pretend success without writing anything.
    if (data.honeypot) {
      return { success: true, message: 'Message sent successfully' };
    }

    await assertSubmissionAllowed('submitContactMessage', getClientIp(context));

    const tenantId = context.tenant?.id ?? context.user?.tenantId;
    if (!tenantId) {
      return { success: false, message: 'Invalid tenant' };
    }
    const { name, email, subject, message } = data;
    if (!name?.trim() || name.trim().length > 255) {
      throw new AppError(
        'Name is required and must be under 255 characters',
        ErrorType.VALIDATION_ERROR,
        400
      );
    }
    if (!email?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      throw new AppError('Valid email is required', ErrorType.VALIDATION_ERROR, 400);
    }
    if (!subject?.trim() || subject.trim().length > 500) {
      throw new AppError(
        'Subject is required and must be under 500 characters',
        ErrorType.VALIDATION_ERROR,
        400
      );
    }
    if (!message?.trim() || message.trim().length > 5000) {
      throw new AppError(
        'Message is required and must be under 5000 characters',
        ErrorType.VALIDATION_ERROR,
        400
      );
    }
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();
    await context.prisma.contactMessage.create({
      data: {
        tenantId,
        name: trimmedName,
        email: trimmedEmail,
        subject: trimmedSubject,
        message: trimmedMessage,
      },
    });

    void sendEmail({
      to: getAdminNotifyEmail(),
      replyTo: trimmedEmail,
      ...adminContactNotificationEmail({
        name: trimmedName,
        email: trimmedEmail,
        subject: trimmedSubject,
        message: trimmedMessage,
      }),
    }).catch((error: unknown) =>
      logger.error(
        'Failed to send contact admin notification email',
        error instanceof Error ? error : undefined
      )
    );

    return { success: true, message: 'Message sent successfully' };
  },

  changeContactMessageStatus: async (
    _: unknown,
    { id, status }: { id: string; status: string },
    context: GraphQLContext
  ) => {
    checkPermission(context, 'content:update');
    const existing = await context.prisma.contactMessage.findFirst({
      where: { id, tenantId: context.user?.tenantId },
    });
    if (!existing) throw new AppError('Contact message not found', ErrorType.NOT_FOUND, 404);
    return context.prisma.contactMessage.update({
      where: { id },
      data: { status: status as never },
    });
  },
};
