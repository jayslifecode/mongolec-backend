import { assertSubmissionAllowed } from '@/middleware/submission-throttle';
import { sendEmail } from '@/libs/email';
import { newsletterWelcomeEmail } from '@/libs/email-templates/newsletter';
import { createLogger } from '@/utils/logger';

const logger = createLogger('NEWSLETTER_MUTATIONS');

function getClientIp(context: any): string {
  return context.req?.ip || context.req?.socket?.remoteAddress || 'unknown';
}

export const newsletterMutations = {
  // Subscribe to newsletter (public - no auth required)
  subscribeToNewsletter: async (_: any, args: any, context: any) => {
    const { data } = args;

    // Honeypot: bots fill hidden fields. Pretend success without writing anything.
    if (data.honeypot) {
      return {
        success: true,
        message: 'Thank you for subscribing to our newsletter!',
      };
    }

    await assertSubmissionAllowed('subscribeToNewsletter', getClientIp(context));

    try {
      // Check if email already subscribed
      const existing = await context.prisma.newsletterSubscription.findFirst({
        where: {
          email: data.email.toLowerCase(),
          tenantId: context.tenant?.id,
          deletedAt: null,
        },
      });

      if (existing) {
        // If unsubscribed, reactivate
        if (existing.status === 'UNSUBSCRIBED') {
          const subscription = await context.prisma.newsletterSubscription.update({
            where: { id: existing.id },
            data: {
              status: 'ACTIVE',
              firstName: data.firstName || existing.firstName,
              lastName: data.lastName || existing.lastName,
              unsubscribedAt: null,
            },
          });

          return {
            success: true,
            message: 'Welcome back! You have been resubscribed to our newsletter.',
            subscription,
          };
        }

        throw new Error('This email is already subscribed to our newsletter');
      }

      // Create subscription
      const subscription = await context.prisma.newsletterSubscription.create({
        data: {
          email: data.email.toLowerCase(),
          firstName: data.firstName,
          lastName: data.lastName,
          tenantId: context.tenant?.id,
          status: 'ACTIVE',
        },
      });

      void sendEmail({
        to: subscription.email,
        ...newsletterWelcomeEmail({ firstName: subscription.firstName }),
      }).catch((error: unknown) =>
        logger.error(
          'Failed to send newsletter welcome email',
          error instanceof Error ? error : undefined
        )
      );

      return {
        success: true,
        message: 'Thank you for subscribing to our newsletter!',
        subscription,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('already subscribed')) throw error;
      console.error('Error subscribing to newsletter:', error);
      throw new Error('Failed to subscribe to newsletter');
    }
  },

  // Unsubscribe from newsletter (public - no auth required, needs unsubscribe token)
  unsubscribeFromNewsletter: async (_: any, args: any, context: any) => {
    const { email } = args;

    try {
      // Find subscription
      const existing = await context.prisma.newsletterSubscription.findFirst({
        where: {
          email: email.toLowerCase(),
          tenantId: context.tenant?.id,
          deletedAt: null,
        },
      });

      if (!existing) {
        throw new Error('Subscription not found');
      }

      if (existing.status === 'UNSUBSCRIBED') {
        throw new Error('This email is already unsubscribed');
      }

      // Unsubscribe
      const subscription = await context.prisma.newsletterSubscription.update({
        where: { id: existing.id },
        data: {
          status: 'UNSUBSCRIBED',
          unsubscribedAt: new Date(),
        },
      });

      return {
        success: true,
        message: 'You have been successfully unsubscribed from our newsletter.',
        subscription,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Subscription not found') throw error;
      if (error instanceof Error && error.message.includes('already unsubscribed')) throw error;
      console.error('Error unsubscribing from newsletter:', error);
      throw new Error('Failed to unsubscribe from newsletter');
    }
  },

  // Update subscription (admin only)
  updateNewsletterSubscription: async (_: any, args: any, context: any) => {
    const { id, data } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions
    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'newsletter' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: newsletter:manage required');
    }

    try {
      // Verify subscription exists
      const existing = await context.prisma.newsletterSubscription.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Newsletter subscription not found');
      }

      // Update subscription
      const subscription = await context.prisma.newsletterSubscription.update({
        where: { id },
        data,
      });

      return subscription;
    } catch (error) {
      if (error instanceof Error && error.message === 'Newsletter subscription not found')
        throw error;
      console.error('Error updating newsletter subscription:', error);
      throw new Error('Failed to update newsletter subscription');
    }
  },

  // Delete subscription (soft delete, admin only)
  deleteNewsletterSubscription: async (_: any, args: any, context: any) => {
    const { id } = args;

    // Check authentication
    if (!context.user) {
      throw new Error('Authentication required');
    }

    // Check permissions
    const hasPermission = context.user.permissions?.some(
      (p: any) => p.resource === 'newsletter' && p.action === 'manage'
    );

    if (!hasPermission) {
      throw new Error('Permission denied: newsletter:manage required');
    }

    try {
      // Verify subscription exists
      const existing = await context.prisma.newsletterSubscription.findFirst({
        where: { id, tenantId: context.tenant?.id, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Newsletter subscription not found');
      }

      // Soft delete
      await context.prisma.newsletterSubscription.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        message: 'Newsletter subscription deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Newsletter subscription not found')
        throw error;
      console.error('Error deleting newsletter subscription:', error);
      throw new Error('Failed to delete newsletter subscription');
    }
  },
};
