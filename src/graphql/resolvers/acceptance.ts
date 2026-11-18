import {
  ACCEPTANCE_PASSPORT_POLICY,
  ACCEPTANCE_PHOTO_POLICY,
  acceptanceUrl,
  decodeAcceptanceFile,
  generateAcceptanceToken,
  isAcceptanceToken,
  riderSlug,
  validateAcceptanceInput,
  type SubmitAcceptanceInput,
} from '@/libs/acceptance';
import { getRfrSiteUrl } from '@/libs/acceptance/site';
import { uploadAcceptancePhoto } from '@/libs/acceptance/storage';
import { sendEmail, getAdminNotifyEmail } from '@/libs/email';
import { adminAcceptanceReceivedEmail } from '@/libs/email-templates/acceptance';
import { assertSubmissionAllowed } from '@/middleware/submission-throttle';
import { assertCanManageApplications, canManageApplications } from '@/utils/application-access';
import { createLogger } from '@/utils/logger';

const logger = createLogger('ACCEPTANCE');

const OPEN_STATUSES = ['APPROVED', 'CONFIRMED'];
const SUBMITTABLE_STATUS = 'APPROVED';
const SUCCESS_MESSAGE = 'Thank you! We have received your acceptance letter.';
const INVALID_LINK = 'This acceptance link is not valid. Please contact us for a new one.';
const ALREADY_SUBMITTED = 'We already have your acceptance letter. Contact us if anything needs to change.';
const SUBMIT_THROTTLE = { limit: 5, windowSec: 600 };

/** Every acceptance column except the passport bytes (those only leave via getAcceptancePassport). */
const ACCEPTANCE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  agreedToCommitment: true,
  agreedToLiability: true,
  usePastPhotoAndBio: true,
  photoUrl: true,
  bio: true,
  shippingAddress: true,
  tshirtSize: true,
  dietaryRestrictions: true,
  roomingPreference: true,
  roommatePreference: true,
  questions: true,
  passportFileName: true,
  submittedAt: true,
};

function displayText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return (value as { en?: string }).en ?? '';
  return '';
}

function clientIp(context: any): string {
  return context.req?.ip || context.req?.socket?.remoteAddress || 'unknown';
}

function findOpenApplication(context: any, token: string) {
  return context.prisma.rallyApplication.findFirst({
    where: { acceptanceToken: token, tenantId: context.tenant?.id, deletedAt: null, status: { in: OPEN_STATUSES } },
    include: { rally: true, acceptance: { select: { id: true } } },
  });
}

function findPastProfile(context: any, application: { firstName: string; lastName: string }) {
  return context.prisma.participant.findFirst({
    where: { tenantId: context.tenant?.id, slug: riderSlug(application.firstName, application.lastName), deletedAt: null },
    select: { id: true, photo: true, bio: true },
  });
}

function hasProfile(participant: { photo?: string | null; bio?: string | null } | null): boolean {
  return Boolean(participant && (participant.photo || participant.bio?.trim()));
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const acceptanceQueries = {
  getAcceptanceInvite: async (_: unknown, { token }: { token: string }, context: any) => {
    if (!isAcceptanceToken(token)) return null;
    const application = await findOpenApplication(context, token);
    if (!application) return null;
    const participant = await findPastProfile(context, application);
    return {
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      rallyTitle: displayText(application.rally.title) || application.rally.slug,
      rallySlug: application.rally.slug,
      rallyStartDate: application.rally.startDate,
      rallyEndDate: application.rally.endDate,
      rallyLocation: displayText(application.rally.location) || null,
      terms: application.rally.acceptanceTerms ?? null,
      alreadySubmitted: Boolean(application.acceptance),
      hasPastProfile: hasProfile(participant),
      pastPhoto: participant?.photo ?? null,
    };
  },

  getAcceptancePassport: async (_: unknown, { applicationId }: { applicationId: string }, context: any) => {
    assertCanManageApplications(context);
    const acceptance = await context.prisma.rallyAcceptance.findFirst({
      where: { applicationId, tenantId: context.tenant?.id },
      select: { passportFileName: true, passportMimeType: true, passportData: true },
    });
    if (!acceptance?.passportData) return null;
    return {
      fileName: acceptance.passportFileName ?? 'passport',
      mimeType: acceptance.passportMimeType ?? 'application/octet-stream',
      base64: Buffer.from(acceptance.passportData).toString('base64'),
    };
  },
};

async function notifyTeam(input: SubmitAcceptanceInput, rallyTitle: string): Promise<void> {
  const template = adminAcceptanceReceivedEmail({
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim(),
    rallyTitle,
  });
  const result = await sendEmail({ to: getAdminNotifyEmail(), ...template, replyTo: input.email.trim() });
  if (!result.sent) logger.info('Acceptance notification not sent', { reason: result.reason });
}

export const acceptanceMutations = {
  submitAcceptance: async (_: unknown, { input }: { input: SubmitAcceptanceInput }, context: any) => {
    if (input.honeypot) return { success: true, message: SUCCESS_MESSAGE };
    await assertSubmissionAllowed('submitAcceptance', clientIp(context), SUBMIT_THROTTLE);

    if (!isAcceptanceToken(input.token)) throw new Error(INVALID_LINK);
    const application = await findOpenApplication(context, input.token);
    if (!application || application.status !== SUBMITTABLE_STATUS) throw new Error(INVALID_LINK);
    if (application.acceptance) throw new Error(ALREADY_SUBMITTED);

    const participant = await findPastProfile(context, application);
    const errors = validateAcceptanceInput(input, { hasPastProfile: hasProfile(participant) });
    if (errors.length > 0) throw new Error(errors.join(' '));

    const reusePast = input.usePastPhotoAndBio;
    const photo = !reusePast && input.photo ? decodeAcceptanceFile(input.photo, ACCEPTANCE_PHOTO_POLICY) : null;
    const passport = input.passport ? decodeAcceptanceFile(input.passport, ACCEPTANCE_PASSPORT_POLICY) : null;
    const photoUrl = photo ? await uploadAcceptancePhoto(photo, riderSlug(input.firstName, input.lastName)) : null;
    const address = input.shippingAddress;

    try {
      await context.prisma.rallyAcceptance.create({
        data: {
          applicationId: application.id,
          tenantId: application.tenantId,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email: input.email.trim().toLowerCase(),
          agreedToCommitment: true,
          agreedToLiability: true,
          usePastPhotoAndBio: reusePast,
          photoUrl,
          bio: reusePast ? null : trimmedOrNull(input.bio),
          shippingAddress: {
            street: address.street.trim(),
            street2: trimmedOrNull(address.street2),
            city: address.city.trim(),
            state: trimmedOrNull(address.state),
            postalCode: trimmedOrNull(address.postalCode),
            country: address.country.trim(),
          },
          tshirtSize: input.tshirtSize.trim(),
          dietaryRestrictions: input.dietaryRestrictions.trim(),
          roomingPreference: input.roomingPreference,
          roommatePreference: trimmedOrNull(input.roommatePreference),
          questions: trimmedOrNull(input.questions),
          passportFileName: passport?.fileName ?? null,
          passportMimeType: passport?.mimeType ?? null,
          passportData: passport?.buffer ?? null,
          ipAddress: clientIp(context),
          userAgent: context.req?.headers?.['user-agent'] ?? null,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(ALREADY_SUBMITTED);
      logger.error('Failed to save acceptance', error instanceof Error ? error : undefined);
      throw new Error('Something went wrong saving your acceptance letter. Please try again.');
    }

    void notifyTeam(input, displayText(application.rally.title) || application.rally.slug);
    return { success: true, message: SUCCESS_MESSAGE };
  },

  ensureAcceptanceLink: async (_: unknown, { applicationId }: { applicationId: string }, context: any) => {
    assertCanManageApplications(context);
    const application = await context.prisma.rallyApplication.findFirst({
      where: { id: applicationId, tenantId: context.tenant?.id, deletedAt: null },
    });
    if (!application) throw new Error('Application not found');
    if (!OPEN_STATUSES.includes(application.status)) throw new Error('Approve the application first.');

    const token =
      application.acceptanceToken ??
      (
        await context.prisma.rallyApplication.update({
          where: { id: application.id },
          data: { acceptanceToken: generateAcceptanceToken(), acceptanceTokenCreatedAt: new Date() },
        })
      ).acceptanceToken;
    return acceptanceUrl(getRfrSiteUrl(), token);
  },
};

/** Fields added to RallyApplication; null for anyone who may not manage applications. */
export const RallyApplicationFields = {
  acceptanceUrl: (parent: any, _args: unknown, context: any) =>
    canManageApplications(context.user) && parent.acceptanceToken ? acceptanceUrl(getRfrSiteUrl(), parent.acceptanceToken) : null,

  acceptance: async (parent: any, _args: unknown, context: any) => {
    if (!canManageApplications(context.user)) return null;
    return context.prisma.rallyAcceptance.findUnique({ where: { applicationId: parent.id }, select: ACCEPTANCE_SELECT });
  },
};

export const RallyAcceptanceFields = {
  hasPassport: (parent: { passportFileName?: string | null }) => Boolean(parent.passportFileName),
};
