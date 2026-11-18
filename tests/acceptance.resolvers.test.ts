jest.mock('../src/libs/email', () => ({
  sendEmail: jest.fn(),
  getAdminNotifyEmail: jest.fn(),
}));
jest.mock('../src/libs/acceptance/storage', () => ({
  uploadAcceptancePhoto: jest.fn(),
  deleteAcceptancePhoto: jest.fn(),
}));
jest.mock('../src/middleware/submission-throttle', () => ({
  assertSubmissionAllowed: jest.fn(),
}));

import {
  acceptanceMutations,
  acceptanceQueries,
  RallyAcceptanceFields,
  RallyApplicationFields,
} from '../src/graphql/resolvers/acceptance';
import { applicationMutations } from '../src/graphql/resolvers/mutations/application';
import { sendEmail, getAdminNotifyEmail } from '../src/libs/email';
import { deleteAcceptancePhoto, uploadAcceptancePhoto } from '../src/libs/acceptance/storage';

const TOKEN = 'A'.repeat(32);
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const PDF_B64 = Buffer.from('%PDF-1.7 test').toString('base64');
const ADMIN = { id: 'admin-1', roles: ['admin'], permissions: ['rally:update'] };

const rally = {
  id: 'rally-1',
  slug: 'mongolia-2027',
  title: { en: 'Mongolia 2027' },
  location: { en: 'Mongolia' },
  startDate: new Date('2027-08-01T00:00:00Z'),
  endDate: new Date('2027-08-14T00:00:00Z'),
  acceptanceTerms: { currency: 'USD', deposit: 5750 },
  maxParticipants: null,
};

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    tenantId: 'tenant-1',
    rallyId: 'rally-1',
    status: 'APPROVED',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    country: 'USA',
    acceptanceToken: TOKEN,
    rally,
    acceptance: null,
    ...overrides,
  };
}

function buildContext({ app = application(), participant = null as any, user = undefined as any } = {}) {
  const prisma: any = {
    rallyApplication: {
      findFirst: jest.fn().mockResolvedValue(app),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...app, ...data })),
    },
    rallyAcceptance: {
      create: jest.fn().mockResolvedValue({ id: 'acc-1' }),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    participant: {
      findFirst: jest.fn().mockResolvedValue(participant),
      create: jest.fn().mockResolvedValue({ id: 'new-rider' }),
      update: jest.fn().mockResolvedValue({ id: participant?.id }),
    },
    participantRally: { upsert: jest.fn().mockResolvedValue({}) },
    rally: { update: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));
  return { prisma, tenant: { id: 'tenant-1' }, user, req: { ip: '1.2.3.4', headers: { 'user-agent': 'jest' } } } as any;
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    agreedToCommitment: true,
    agreedToLiability: true,
    usePastPhotoAndBio: false,
    photo: { fileName: 'jane.jpg', mimeType: 'image/jpeg', base64: JPEG_B64 },
    bio: 'I ride for rangers.',
    shippingAddress: { street: '1 Main St', city: 'Boston', country: 'USA' },
    tshirtSize: 'M',
    dietaryRestrictions: 'None',
    roomingPreference: 'TWIN',
    passport: { fileName: 'passport.pdf', mimeType: 'application/pdf', base64: PDF_B64 },
    ...overrides,
  };
}

beforeEach(() => {
  (sendEmail as jest.Mock).mockResolvedValue({ sent: true });
  (getAdminNotifyEmail as jest.Mock).mockReturnValue('team@example.com');
  (uploadAcceptancePhoto as jest.Mock).mockResolvedValue('https://cdn.example.com/rfr/riders/acceptance/jane-doe-1.jpg');
});

describe('getAcceptanceInvite (public)', () => {
  it('returns null for a malformed token without touching the database', async () => {
    const ctx = buildContext();
    expect(await acceptanceQueries.getAcceptanceInvite(null, { token: 'nope' }, ctx)).toBeNull();
    expect(ctx.prisma.rallyApplication.findFirst).not.toHaveBeenCalled();
  });

  it('only finds approved or confirmed applications of this tenant by token', async () => {
    const ctx = buildContext();
    await acceptanceQueries.getAcceptanceInvite(null, { token: TOKEN }, ctx);
    const [{ where }] = ctx.prisma.rallyApplication.findFirst.mock.calls[0];
    expect(where).toMatchObject({ acceptanceToken: TOKEN, tenantId: 'tenant-1', deletedAt: null, status: { in: ['APPROVED', 'CONFIRMED'] } });
  });

  it('describes the rally and offers the past photo of a returning rider', async () => {
    const ctx = buildContext({ participant: { id: 'p1', photo: 'https://cdn/old.jpg', bio: 'Old bio' } });
    const invite = await acceptanceQueries.getAcceptanceInvite(null, { token: TOKEN }, ctx);
    expect(invite).toMatchObject({
      firstName: 'Jane',
      email: 'jane@example.com',
      rallyTitle: 'Mongolia 2027',
      rallySlug: 'mongolia-2027',
      rallyLocation: 'Mongolia',
      terms: { currency: 'USD', deposit: 5750 },
      alreadySubmitted: false,
      hasPastProfile: true,
      pastPhoto: 'https://cdn/old.jpg',
    });
  });
});

describe('submitAcceptance (public)', () => {
  it('pretends success for bots (honeypot) without writing', async () => {
    const ctx = buildContext();
    const result = await acceptanceMutations.submitAcceptance(null, { input: submission({ honeypot: 'spam' }) }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.prisma.rallyAcceptance.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown link', async () => {
    const ctx = buildContext({ app: null as any });
    await expect(acceptanceMutations.submitAcceptance(null, { input: submission() }, ctx)).rejects.toThrow(
      'This acceptance link is not valid'
    );
  });

  it('refuses a second submission', async () => {
    const ctx = buildContext({ app: application({ acceptance: { id: 'acc-0' } }) });
    await expect(acceptanceMutations.submitAcceptance(null, { input: submission() }, ctx)).rejects.toThrow(
      'We already have your acceptance letter'
    );
  });

  it('returns every validation problem in one message', async () => {
    const ctx = buildContext();
    await expect(
      acceptanceMutations.submitAcceptance(null, { input: submission({ agreedToLiability: false, tshirtSize: '' }) }, ctx)
    ).rejects.toThrow('Please agree to the liability agreement. Please enter your T-shirt size.');
    expect(ctx.prisma.rallyAcceptance.create).not.toHaveBeenCalled();
  });

  it('stores the answers, uploads the photo publicly, keeps the passport private and tells the team', async () => {
    const ctx = buildContext();
    const result = await acceptanceMutations.submitAcceptance(null, { input: submission() }, ctx);

    expect(result.success).toBe(true);
    expect(uploadAcceptancePhoto).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg' }), 'jane-doe');
    const [{ data }] = ctx.prisma.rallyAcceptance.create.mock.calls[0];
    expect(data).toMatchObject({
      applicationId: 'app-1',
      tenantId: 'tenant-1',
      photoUrl: 'https://cdn.example.com/rfr/riders/acceptance/jane-doe-1.jpg',
      bio: 'I ride for rangers.',
      roomingPreference: 'TWIN',
      passportFileName: 'passport.pdf',
      passportMimeType: 'application/pdf',
      ipAddress: '1.2.3.4',
    });
    expect(Buffer.from(data.passportData).toString()).toBe('%PDF-1.7 test');
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'team@example.com' }));
  });

  it('a returning rider may reuse their past photo and bio (no upload)', async () => {
    const ctx = buildContext({ participant: { id: 'p1', photo: 'https://cdn/old.jpg', bio: 'Old' } });
    await acceptanceMutations.submitAcceptance(null, { input: submission({ usePastPhotoAndBio: true, photo: null, bio: null }) }, ctx);
    expect(uploadAcceptancePhoto).not.toHaveBeenCalled();
    const [{ data }] = ctx.prisma.rallyAcceptance.create.mock.calls[0];
    expect(data).toMatchObject({ usePastPhotoAndBio: true, photoUrl: null, bio: null });
  });
});

describe('approveApplication creates the private link and emails it', () => {
  it('generates a token when the application has none and sends the invite', async () => {
    const ctx = buildContext({ app: application({ status: 'PENDING', acceptanceToken: null }), user: ADMIN });
    await applicationMutations.approveApplication(null, { id: 'app-1' }, ctx);

    const [{ data }] = ctx.prisma.rallyApplication.update.mock.calls[0];
    expect(data.status).toBe('APPROVED');
    expect(data.acceptanceToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com', html: expect.stringContaining(`/acceptance/${data.acceptanceToken}`) })
    );
  });

  it('keeps an existing token (re-approving never breaks a link already sent)', async () => {
    const ctx = buildContext({ app: application({ status: 'WAITLIST' }), user: ADMIN });
    await applicationMutations.approveApplication(null, { id: 'app-1' }, ctx);
    const [{ data }] = ctx.prisma.rallyApplication.update.mock.calls[0];
    expect(data.acceptanceToken).toBeUndefined();
  });
});

describe('confirmApplication puts the rider on the roster', () => {
  const acceptance = { id: 'acc-1', usePastPhotoAndBio: false, photoUrl: 'https://cdn/new.jpg', bio: 'New bio', firstName: 'Jane', lastName: 'Doe' };

  it('refuses until the acceptance letter is in', async () => {
    const ctx = buildContext({ user: ADMIN });
    await expect(applicationMutations.confirmApplication(null, { id: 'app-1' }, ctx)).rejects.toThrow(
      'The acceptance letter has not been received yet'
    );
  });

  it('creates a new rider with the featured photo and links them to the rally', async () => {
    const ctx = buildContext({ app: application({ acceptance }), user: ADMIN });
    await applicationMutations.confirmApplication(null, { id: 'app-1' }, ctx);

    expect(ctx.prisma.participant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'tenant-1', slug: 'jane-doe', photo: 'https://cdn/new.jpg', bio: 'New bio', country: 'USA' }),
    });
    expect(ctx.prisma.participantRally.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { participantId_rallyId: { participantId: 'new-rider', rallyId: 'rally-1' } },
        create: { participantId: 'new-rider', rallyId: 'rally-1', year: 2027, role: 'Rider' },
      })
    );
    expect(ctx.prisma.rallyApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CONFIRMED' } }));
  });

  it('updates a returning rider: the new rally photo becomes the featured photo (and revives a hidden row)', async () => {
    const ctx = buildContext({ app: application({ acceptance }), participant: { id: 'p1', photo: 'https://cdn/old.jpg', bio: 'Old' }, user: ADMIN });
    await applicationMutations.confirmApplication(null, { id: 'app-1' }, ctx);
    expect(ctx.prisma.participant.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { photo: 'https://cdn/new.jpg', bio: 'New bio', deletedAt: null, isActive: true },
    });
  });
});

describe('admin-only acceptance access', () => {
  it('ensureAcceptanceLink returns the full link for an approved application', async () => {
    const ctx = buildContext({ user: ADMIN });
    const url = await acceptanceMutations.ensureAcceptanceLink(null, { applicationId: 'app-1' }, ctx);
    expect(url).toBe(`https://rally-for-rangers-website.vercel.app/acceptance/${TOKEN}`);
  });

  it('ensureAcceptanceLink refuses anonymous callers and unapproved applications', async () => {
    await expect(acceptanceMutations.ensureAcceptanceLink(null, { applicationId: 'app-1' }, buildContext())).rejects.toThrow(
      /authentication required/i
    );
    const pending = buildContext({ app: application({ status: 'PENDING' }), user: ADMIN });
    await expect(acceptanceMutations.ensureAcceptanceLink(null, { applicationId: 'app-1' }, pending)).rejects.toThrow(
      'Approve the application first'
    );
  });

  it('getAcceptancePassport returns the file to admins only', async () => {
    const ctx = buildContext({ user: ADMIN });
    ctx.prisma.rallyAcceptance.findFirst.mockResolvedValue({
      passportFileName: 'passport.pdf',
      passportMimeType: 'application/pdf',
      passportData: Buffer.from('%PDF-1.7 test'),
    });
    const file = await acceptanceQueries.getAcceptancePassport(null, { applicationId: 'app-1' }, ctx);
    expect(file).toEqual({ fileName: 'passport.pdf', mimeType: 'application/pdf', base64: PDF_B64 });

    await expect(acceptanceQueries.getAcceptancePassport(null, { applicationId: 'app-1' }, buildContext())).rejects.toThrow(
      /authentication required/i
    );
  });

  it('application link and answers resolve to null for anyone but an admin, and never load passport bytes', async () => {
    const parent = { id: 'app-1', acceptanceToken: TOKEN };
    expect(RallyApplicationFields.acceptanceUrl(parent, {}, { user: undefined })).toBeNull();
    expect(await RallyApplicationFields.acceptance(parent, {}, { user: undefined, prisma: {} })).toBeNull();

    const ctx = buildContext({ user: ADMIN });
    await RallyApplicationFields.acceptance(parent, {}, ctx);
    const [{ select }] = ctx.prisma.rallyAcceptance.findUnique.mock.calls[0];
    expect(select.passportData).toBeUndefined();
    expect(select.passportFileName).toBe(true);
    expect(RallyAcceptanceFields.hasPassport({ passportFileName: 'p.pdf' })).toBe(true);
  });
});

describe('security review follow-ups', () => {
  const acceptance = { id: 'acc-1', usePastPhotoAndBio: false, photoUrl: 'https://cdn/new.jpg', bio: 'New bio', firstName: 'Jane', lastName: 'Doe' };

  it('confirm matches the rider by the application names admin reviewed, never the names typed in the letter', async () => {
    const typedOtherName = { ...acceptance, firstName: 'Famous', lastName: 'Rider' };
    const ctx = buildContext({ app: application({ acceptance: typedOtherName }), user: ADMIN });
    await applicationMutations.confirmApplication(null, { id: 'app-1' }, ctx);
    const [{ where }] = ctx.prisma.participant.findFirst.mock.calls[0];
    expect(where.slug).toBe('jane-doe');
    expect(ctx.prisma.participant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ firstName: 'Jane', lastName: 'Doe', slug: 'jane-doe' }),
    });
  });

  it('a name with no Latin letters never matches an existing rider and gets its own slug', async () => {
    const app = application({ firstName: 'Батбаяр', lastName: 'Дорж', acceptance: { ...acceptance, firstName: 'Батбаяр', lastName: 'Дорж' } });
    const ctx = buildContext({ app, participant: { id: 'someone-else', photo: 'x', bio: 'y' }, user: ADMIN });
    await applicationMutations.confirmApplication(null, { id: 'app-1' }, ctx);
    expect(ctx.prisma.participant.findFirst).not.toHaveBeenCalled();
    expect(ctx.prisma.participant.update).not.toHaveBeenCalled();
    expect(ctx.prisma.participant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: 'rider-app-1', firstName: 'Батбаяр', lastName: 'Дорж' }),
    });
  });

  it('the invite never looks up a past profile for an empty slug', async () => {
    const ctx = buildContext({ app: application({ firstName: 'Батбаяр', lastName: 'Дорж' }), participant: { id: 'x', photo: 'p', bio: 'b' } });
    const invite = await acceptanceQueries.getAcceptanceInvite(null, { token: TOKEN }, ctx);
    expect(invite).toMatchObject({ hasPastProfile: false, pastPhoto: null });
    expect(ctx.prisma.participant.findFirst).not.toHaveBeenCalled();
  });

  it('once the letter is in, the invite stops returning the email and past photo', async () => {
    const ctx = buildContext({ app: application({ acceptance: { id: 'acc-1' } }), participant: { id: 'p1', photo: 'https://cdn/old.jpg', bio: 'b' } });
    const invite = await acceptanceQueries.getAcceptanceInvite(null, { token: TOKEN }, ctx);
    expect(invite).toMatchObject({ alreadySubmitted: true, email: '', pastPhoto: null, hasPastProfile: false });
  });

  it('public acceptance calls refuse to run without a tenant', async () => {
    const ctx = buildContext();
    ctx.tenant = undefined;
    expect(await acceptanceQueries.getAcceptanceInvite(null, { token: TOKEN }, ctx)).toBeNull();
    await expect(acceptanceMutations.submitAcceptance(null, { input: submission() }, ctx)).rejects.toThrow('This acceptance link is not valid');
    expect(ctx.prisma.rallyApplication.findFirst).not.toHaveBeenCalled();
  });

  it('removes the uploaded photo again when saving the letter fails', async () => {
    const ctx = buildContext();
    ctx.prisma.rallyAcceptance.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(acceptanceMutations.submitAcceptance(null, { input: submission() }, ctx)).rejects.toThrow('We already have your acceptance letter');
    expect(deleteAcceptancePhoto).toHaveBeenCalledWith('https://cdn.example.com/rfr/riders/acceptance/jane-doe-1.jpg');
  });
});
