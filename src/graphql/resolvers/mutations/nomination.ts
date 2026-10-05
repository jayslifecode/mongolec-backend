import { assertSubmissionAllowed } from '@/middleware/submission-throttle';
import { sendEmail, getAdminNotifyEmail } from '@/libs/email';
import {
  nominatorConfirmationEmail,
  adminNominationNotificationEmail,
} from '@/libs/email-templates/nomination';
import { createLogger } from '@/utils/logger';

const logger = createLogger('NOMINATION_MUTATIONS');

function getClientIp(context: any): string {
  return context.req?.ip || context.req?.socket?.remoteAddress || 'unknown';
}

export const nominationMutations = {
  // Submit a park nomination (public - no auth required)
  submitParkNomination: async (_: any, args: any, context: any) => {
    const { data } = args;

    // Honeypot: bots fill hidden fields. Pretend success without writing anything.
    if (data.honeypot) {
      return {
        success: true,
        message:
          'Park nomination submitted successfully! We will review your nomination and contact you soon.',
        nomination: null,
      };
    }

    await assertSubmissionAllowed('submitParkNomination', getClientIp(context));

    try {
      const { honeypot: _honeypot, ...nominationData } = data;

      // Check if this partner email already submitted a nomination
      const existing = await context.prisma.parkNomination.findFirst({
        where: {
          partnerContactEmail: data.partnerContactEmail.toLowerCase(),
          tenantId: context.tenant?.id,
          deletedAt: null,
        },
      });

      if (existing) {
        throw new Error('You have already submitted a nomination');
      }

      // Create nomination
      const nomination = await context.prisma.parkNomination.create({
        data: {
          ...nominationData,
          partnerContactEmail: data.partnerContactEmail.toLowerCase(),
          tenantId: context.tenant?.id,
          status: 'PENDING',
        },
      });

      const emailData = {
        nominatorFirstName: nomination.partnerContactFirstName,
        nominatorLastName: nomination.partnerContactLastName,
        nominatorEmail: nomination.partnerContactEmail,
        country: nomination.country,
      };
      void sendEmail({
        to: nomination.partnerContactEmail,
        ...nominatorConfirmationEmail(emailData),
      }).catch((error: unknown) =>
        logger.error(
          'Failed to send nominator confirmation email',
          error instanceof Error ? error : undefined
        )
      );
      void sendEmail({
        to: getAdminNotifyEmail(),
        ...adminNominationNotificationEmail(emailData),
      }).catch((error: unknown) =>
        logger.error(
          'Failed to send admin nomination notification email',
          error instanceof Error ? error : undefined
        )
      );

      return {
        success: true,
        message:
          'Park nomination submitted successfully! We will review your nomination and contact you soon.',
        nomination,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('already submitted')) throw error;
      console.error('Error submitting nomination:', JSON.stringify(error, null, 2), error);
      throw new Error('Failed to submit nomination');
    }
  },

  // Update nomination (admin only)
  updateParkNomination: async (_: any, args: any, context: any) => {
    const { id, data } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions
    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'nomination' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: nomination:manage required');
    }

    try {
      // Verify nomination exists
      const existing = await context.prisma.parkNomination.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Nomination not found');
      }

      // Update nomination
      const nomination = await context.prisma.parkNomination.update({
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

      return nomination;
    } catch (error) {
      if (error instanceof Error && error.message === 'Nomination not found') throw error;
      console.error('Error updating nomination:', error);
      throw new Error('Failed to update nomination');
    }
  },

  // Update nomination status (admin only)
  changeNominationStatus: async (_: any, args: any, context: any) => {
    const { id, status, notes } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions
    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'nomination' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: nomination:manage required');
    }

    try {
      // Verify nomination exists
      const existing = await context.prisma.parkNomination.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Nomination not found');
      }

      // Update status
      const nomination = await context.prisma.parkNomination.update({
        where: { id },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedBy: context.user.id,
          ...(notes && { reviewNotes: notes }),
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

      // TODO: Send status update email

      return nomination;
    } catch (error) {
      if (error instanceof Error && error.message === 'Nomination not found') throw error;
      console.error('Error updating nomination status:', error);
      throw new Error('Failed to update nomination status');
    }
  },

  // Approve nomination
  approveNomination: async (_: any, args: any, context: any) => {
    const { id, notes } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions
    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'nomination' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: nomination:manage required');
    }

    try {
      // Verify nomination exists
      const existing = await context.prisma.parkNomination.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
        include: {
          rally: true,
        },
      });

      if (!existing) {
        throw new Error('Nomination not found');
      }

      // Approve nomination
      const nomination = await context.prisma.parkNomination.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedBy: context.user.id,
          ...(notes && { reviewNotes: { note: notes, type: 'approval' } }),
        },
      });

      // TODO: Send approval email
      // TODO: Consider creating park partnership if approved

      return nomination;
    } catch (error) {
      if (error instanceof Error && error.message === 'Nomination not found') {
        throw error;
      }
      console.error('Error approving nomination:', error);
      throw new Error('Failed to approve nomination');
    }
  },

  // Reject nomination
  rejectNomination: async (_: any, args: any, context: any) => {
    const { id, reason } = args;

    if (!reason) {
      throw new Error('Rejection reason is required');
    }

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions
    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'nomination' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: nomination:manage required');
    }

    try {
      // Verify nomination exists
      const existing = await context.prisma.parkNomination.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Nomination not found');
      }

      // Reject nomination
      const nomination = await context.prisma.parkNomination.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedAt: new Date(),
          reviewedBy: context.user.id,
          reviewNotes: { reason, type: 'rejection' },
        },
      });

      // TODO: Send rejection email

      return nomination;
    } catch (error) {
      if (error instanceof Error && error.message === 'Nomination not found') throw error;
      console.error('Error rejecting nomination:', error);
      throw new Error('Failed to reject nomination');
    }
  },

  // Add admin review notes
  addNominationReviewNote: async (_: any, args: any, context: any) => {
    const { id, notes } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions
    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'nomination' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: nomination:manage required');
    }

    try {
      // Verify nomination exists
      const existing = await context.prisma.parkNomination.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Nomination not found');
      }

      // Add notes
      const nomination = await context.prisma.parkNomination.update({
        where: { id },
        data: {
          reviewNotes: {
            ...(existing.reviewNotes || {}),
            ...notes,
            lastUpdatedBy: context.user.id,
            lastUpdatedAt: new Date().toISOString(),
          },
        },
      });

      return nomination;
    } catch (error) {
      if (error instanceof Error && error.message === 'Nomination not found') throw error;
      console.error('Error adding review notes:', error);
      throw new Error('Failed to add review notes');
    }
  },

  // Delete nomination (soft delete, admin only)
  deleteParkNomination: async (_: any, args: any, context: any) => {
    const { id } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions
    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'nomination' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: nomination:manage required');
    }

    try {
      // Verify nomination exists
      const existing = await context.prisma.parkNomination.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Nomination not found');
      }

      // Soft delete
      await context.prisma.parkNomination.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        message: 'Nomination deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Nomination not found') throw error;
      console.error('Error deleting nomination:', error);
      throw new Error('Failed to delete nomination');
    }
  },
};
