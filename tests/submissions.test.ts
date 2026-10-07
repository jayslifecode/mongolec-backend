jest.mock('../src/libs/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ sent: true, id: 'email-1' }),
  getAdminNotifyEmail: jest.fn().mockReturnValue('info@rally4rangers.org'),
}));

import { applicationMutations } from '../src/graphql/resolvers/mutations/application';
import { assertSubmissionAllowed } from '../src/middleware/submission-throttle';
import { sendEmail } from '../src/libs/email';

function buildContext(overrides: Partial<any> = {}) {
  return {
    tenant: { id: 'tenant-1' },
    req: { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } },
    prisma: {
      rally: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rally-1',
          isRecruiting: true,
          applicationDeadline: null,
          maxParticipants: null,
          currentParticipants: 0,
        }),
      },
      rallyApplication: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'app-1',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          rally: { id: 'rally-1', slug: 'mongolia-2027', title: { en: 'Mongolia 2027' } },
        }),
        count: jest.fn().mockResolvedValue(0),
      },
    },
    ...overrides,
  } as any;
}

describe('Public submission hardening', () => {
  beforeEach(() => {
    // jest.config.js sets resetMocks:true, which wipes mockResolvedValue set in
    // the jest.mock() factory before every test, so re-apply it here.
    (sendEmail as jest.Mock).mockResolvedValue({ sent: true, id: 'email-1' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('honeypot', () => {
    it('short-circuits submitRallyApplication without writing to prisma', async () => {
      const context = buildContext();
      const result = await applicationMutations.submitRallyApplication(
        null,
        { data: { rallyId: 'rally-1', email: 'bot@example.com', honeypot: 'spam' } },
        context
      );

      expect(result.success).toBe(true);
      expect(context.prisma.rallyApplication.create).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('assertSubmissionAllowed (in-memory fallback)', () => {
    it('throws RATE_LIMITED after the limit is exceeded for the same key+ip', async () => {
      const key = `test-key-${Date.now()}`;
      const ip = '10.0.0.1';

      for (let i = 0; i < 5; i += 1) {
        await expect(
          assertSubmissionAllowed(key, ip, { limit: 5, windowSec: 600 })
        ).resolves.toBeUndefined();
      }

      await expect(assertSubmissionAllowed(key, ip, { limit: 5, windowSec: 600 })).rejects.toThrow(
        'Too many submissions, please try again later.'
      );
    });

    it('tracks separate keys/ips independently', async () => {
      const ip = `10.0.0.${Math.floor(Math.random() * 250)}`;
      await expect(
        assertSubmissionAllowed('independent-key', ip, { limit: 1, windowSec: 600 })
      ).resolves.toBeUndefined();
      await expect(
        assertSubmissionAllowed('independent-key-2', ip, { limit: 1, windowSec: 600 })
      ).resolves.toBeUndefined();
    });
  });

  describe('email on submission', () => {
    it('sends a confirmation email to the applicant address', async () => {
      const context = buildContext();
      // use a fresh ip to avoid throttle bleed from the limit test above
      context.req.ip = `10.1.${Math.floor(Math.random() * 250)}.1`;

      await applicationMutations.submitRallyApplication(
        null,
        {
          data: {
            rallyId: 'rally-1',
            email: 'jane@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        },
        context
      );

      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com' }));
    });
  });
});
