import { assertSubmissionAllowed } from '@/middleware/submission-throttle';
import { sendEmail, getAdminNotifyEmail } from '@/libs/email';
import {
  applicantConfirmationEmail,
  adminApplicationNotificationEmail,
} from '@/libs/email-templates/application';
import { createLogger } from '@/utils/logger';
import { assertCanManageApplications, canManageApplications } from '@/utils/application-access';
import { acceptanceUrl, generateAcceptanceToken } from '@/libs/acceptance';
import { syncConfirmedRider } from '@/libs/acceptance/confirm';
import { getRfrSiteUrl } from '@/libs/acceptance/site';
import { acceptanceInviteEmail } from '@/libs/email-templates/acceptance';

const logger = createLogger('APPLICATION_MUTATIONS');

function getClientIp(context: any): string {
  return context.req?.ip || context.req?.socket?.remoteAddress || 'unknown';
}

const ACCEPTANCE_MISSING = 'The acceptance letter has not been received yet.';

/** Emails an approved rider their private acceptance-letter link (no-op until email is configured). */
async function sendAcceptanceInvite(
  application: { firstName: string; email: string; acceptanceToken: string | null },
  rally: { title: unknown; slug: string }
): Promise<void> {
  if (!application.acceptanceToken) return;
  const rallyTitle = (rally.title as { en?: string } | undefined)?.en || rally.slug;
  const template = acceptanceInviteEmail({
    firstName: application.firstName,
    rallyTitle,
    acceptanceUrl: acceptanceUrl(getRfrSiteUrl(), application.acceptanceToken),
  });
  const result = await sendEmail({ to: application.email, ...template });
  if (!result.sent) logger.info('Acceptance invite not sent', { reason: result.reason });
}

export const applicationMutations = {
  // Submit a rally application (public - no auth required)
  submitRallyApplication: async (_: any, args: any, context: any) => {
    const { data } = args;

    // Honeypot: bots fill hidden fields. Pretend success without writing anything.
    if (data.honeypot) {
      return {
        success: true,
        message:
          'Application submitted successfully! We will review your application and contact you soon.',
        application: null,
      };
    }

    await assertSubmissionAllowed('submitRallyApplication', getClientIp(context));

    try {
      const { honeypot: _honeypot, ...applicationData } = data;

      // Verify rally exists and is recruiting
      const rally = await context.prisma.rally.findFirst({
        where: {
          id: data.rallyId,
          tenantId: context.tenant?.id,
          deletedAt: null,
          isRecruiting: true,
        },
      });

      if (!rally) {
        throw new Error('Rally not found or not accepting applications');
      }

      // Check if deadline passed
      if (rally.applicationDeadline && new Date(rally.applicationDeadline) < new Date()) {
        throw new Error('Application deadline has passed');
      }

      // Check if rally is full
      if (rally.maxParticipants && rally.currentParticipants >= rally.maxParticipants) {
        throw new Error('Rally is fully booked');
      }

      // Check if email already applied
      const existing = await context.prisma.rallyApplication.findFirst({
        where: {
          rallyId: data.rallyId,
          email: data.email.toLowerCase(),
          tenantId: context.tenant?.id,
          deletedAt: null,
        },
      });

      if (existing) {
        throw new Error('You have already applied to this rally');
      }

      // Check if max participants reached
      if (rally.maxParticipants) {
        const currentCount = await context.prisma.rallyApplication.count({
          where: {
            rallyId: data.rallyId,
            status: { in: ['APPROVED', 'CONFIRMED'] },
            deletedAt: null,
          },
        });

        if (currentCount >= rally.maxParticipants) {
          throw new Error('Rally is fully booked');
        }
      }

      // Create application
      const application = await context.prisma.rallyApplication.create({
        data: {
          ...applicationData,
          email: data.email.toLowerCase(),
          tenantId: context.tenant?.id,
          status: 'PENDING',
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
        },
      });

      const rallyTitle =
        (application.rally?.title as { en?: string } | undefined)?.en ||
        application.rally?.slug ||
        'the rally';
      const emailData = {
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        rallyTitle,
      };
      void sendEmail({
        to: application.email,
        ...applicantConfirmationEmail(emailData),
      }).catch((error: unknown) =>
        logger.error(
          'Failed to send applicant confirmation email',
          error instanceof Error ? error : undefined
        )
      );
      void sendEmail({
        to: getAdminNotifyEmail(),
        ...adminApplicationNotificationEmail(emailData),
      }).catch((error: unknown) =>
        logger.error(
          'Failed to send admin application notification email',
          error instanceof Error ? error : undefined
        )
      );

      return {
        success: true,
        message:
          'Application submitted successfully! We will review your application and contact you soon.',
        application,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('already applied')) throw error;
      if (error instanceof Error && error.message.includes('not found')) throw error;
      if (error instanceof Error && error.message.includes('deadline')) throw error;
      if (error instanceof Error && error.message.includes('fully booked')) throw error;
      console.error('Error submitting application:', error);
      throw new Error('Failed to submit application');
    }
  },

  // Update application (admin only)
  updateRallyApplication: async (_: any, args: any, context: any) => {
    const { id, data } = args;

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // Update application
      const application = await context.prisma.rallyApplication.update({
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

      return application;
    } catch (error) {
      if (error instanceof Error && error.message === 'Application not found') throw error;
      console.error('Error updating application:', error);
      throw new Error('Failed to update application');
    }
  },

  // Update application status (admin only)
  changeApplicationStatus: async (_: any, args: any, context: any) => {
    const { id, status, notes } = args;

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // Update status
      const application = await context.prisma.rallyApplication.update({
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

      return application;
    } catch (error) {
      if (error instanceof Error && error.message === 'Application not found') throw error;
      console.error('Error updating application status:', error);
      throw new Error('Failed to update application status');
    }
  },

  // Approve application
  approveApplication: async (_: any, args: any, context: any) => {
    const { id, notes } = args;

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
        include: {
          rally: true,
        },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // Check if rally has space
      if (existing.rally.maxParticipants) {
        const confirmedCount = await context.prisma.rallyApplication.count({
          where: {
            rallyId: existing.rallyId,
            status: { in: ['APPROVED', 'CONFIRMED'] },
            deletedAt: null,
          },
        });

        if (confirmedCount >= existing.rally.maxParticipants) {
          throw new Error('Rally is fully booked');
        }
      }

      // Approve application. The private acceptance-letter link is created once and kept, so a
      // link already sent keeps working if the application is approved again.
      const application = await context.prisma.rallyApplication.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedBy: context.user.id,
          ...(notes && { reviewNotes: { note: notes, type: 'approval' } }),
          ...(!existing.acceptanceToken && {
            acceptanceToken: generateAcceptanceToken(),
            acceptanceTokenCreatedAt: new Date(),
          }),
        },
      });

      // Update rally participant count
      await context.prisma.rally.update({
        where: { id: existing.rallyId },
        data: {
          currentParticipants: { increment: 1 },
        },
      });

      void sendAcceptanceInvite(application, existing.rally);

      return application;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Application not found' || error.message.includes('fully booked'))
      ) {
        throw error;
      }
      console.error('Error approving application:', error);
      throw new Error('Failed to approve application');
    }
  },

  // Reject application
  rejectApplication: async (_: any, args: any, context: any) => {
    const { id, reason } = args;

    if (!reason) {
      throw new Error('Rejection reason is required');
    }

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // Reject application
      const application = await context.prisma.rallyApplication.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedAt: new Date(),
          reviewedBy: context.user.id,
          reviewNotes: { reason, type: 'rejection' },
        },
      });

      // TODO: Send rejection email

      return application;
    } catch (error) {
      if (error instanceof Error && error.message === 'Application not found') throw error;
      console.error('Error rejecting application:', error);
      throw new Error('Failed to reject application');
    }
  },

  // Waitlist application
  waitlistApplication: async (_: any, args: any, context: any) => {
    const { id, notes } = args;

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // Waitlist application
      const application = await context.prisma.rallyApplication.update({
        where: { id },
        data: {
          status: 'WAITLIST',
          reviewedAt: new Date(),
          reviewedBy: context.user.id,
          ...(notes && { reviewNotes: { note: notes, type: 'waitlist' } }),
        },
      });

      // TODO: Send waitlist email

      return application;
    } catch (error) {
      if (error instanceof Error && error.message === 'Application not found') throw error;
      console.error('Error waitlisting application:', error);
      throw new Error('Failed to waitlist application');
    }
  },

  // Confirm application
  confirmApplication: async (_: any, args: any, context: any) => {
    const { id } = args;

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
        include: { rally: true, acceptance: true },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // The spot is secured by the acceptance letter (commitment + liability) plus the deposit,
      // so confirming waits for the letter. Confirming then puts the rider on the roster with the
      // acceptance photo as their featured photo, linked to this rally.
      if (!existing.acceptance) {
        throw new Error(ACCEPTANCE_MISSING);
      }

      const application = await context.prisma.$transaction(async (tx: any) => {
        await syncConfirmedRider(tx, existing);
        return tx.rallyApplication.update({
          where: { id },
          data: { status: 'CONFIRMED' },
        });
      });

      return application;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Application not found' || error.message === ACCEPTANCE_MISSING)
      ) {
        throw error;
      }
      console.error('Error confirming application:', error);
      throw new Error('Failed to confirm application');
    }
  },

  // Cancel application (user or admin)
  cancelApplication: async (_: any, args: any, context: any) => {
    const { id, reason } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions (can cancel own application or if admin)
    const isAdmin = canManageApplications(context.user);

    const existing = await context.prisma.rallyApplication.findFirst({
      where: { id, tenantId: context.tenant?.id, deletedAt: null },
    });

    if (!existing) {
      throw new Error('Application not found');
    }

    // Check if user owns this application or is admin
    if (!isAdmin && existing.email !== context.user.email) {
      throw new Error('You can only cancel your own application');
    }

    try {
      // Cancel application
      const application = await context.prisma.rallyApplication.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          reviewNotes: {
            ...(existing.reviewNotes || {}),
            cancellationReason: reason || 'User cancelled',
            cancelledAt: new Date().toISOString(),
          },
        },
      });

      // Decrease rally participant count if was approved
      if (existing.status === 'APPROVED' || existing.status === 'CONFIRMED') {
        await context.prisma.rally.update({
          where: { id: existing.rallyId },
          data: {
            currentParticipants: { decrement: 1 },
          },
        });
      }

      // TODO: Send cancellation email

      return application;
    } catch (error) {
      console.error('Error cancelling application:', error);
      throw new Error('Failed to cancel application');
    }
  },

  // Add admin review notes
  addApplicationReviewNote: async (_: any, args: any, context: any) => {
    const { id, notes } = args;

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // Add notes
      const application = await context.prisma.rallyApplication.update({
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

      return application;
    } catch (error) {
      if (error instanceof Error && error.message === 'Application not found') throw error;
      console.error('Error adding review notes:', error);
      throw new Error('Failed to add review notes');
    }
  },

  // Update payment status
  changeApplicationPaymentStatus: async (_: any, args: any, context: any) => {
    const { id, depositPaid, depositAmount, fullyPaid, totalAmount, fundraisingStatus } = args;

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // Update payment status
      const application = await context.prisma.rallyApplication.update({
        where: { id },
        data: {
          ...(depositPaid !== undefined && { depositPaid }),
          ...(depositAmount !== undefined && { depositAmount }),
          ...(fullyPaid !== undefined && { fullyPaid }),
          ...(totalAmount !== undefined && { totalAmount }),
          ...(fundraisingStatus && { fundraisingStatus }),
        },
      });

      return application;
    } catch (error) {
      if (error instanceof Error && error.message === 'Application not found') throw error;
      console.error('Error updating payment status:', error);
      throw new Error('Failed to update payment status');
    }
  },

  // Delete application (soft delete, admin only)
  deleteRallyApplication: async (_: any, args: any, context: any) => {
    const { id } = args;

    assertCanManageApplications(context);

    try {
      // Verify application exists
      const existing = await context.prisma.rallyApplication.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Application not found');
      }

      // Soft delete
      await context.prisma.rallyApplication.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        message: 'Application deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Application not found') throw error;
      console.error('Error deleting application:', error);
      throw new Error('Failed to delete application');
    }
  },
};
