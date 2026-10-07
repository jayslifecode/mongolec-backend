import { participantMutations } from '../src/graphql/resolvers/mutations/participant';

function buildContext(overrides: any = {}) {
  const prisma = {
    participant: {
      count: jest.fn().mockResolvedValue(0),
      // Distinguish the "does this participant exist" lookup (where.id set) from the
      // "is this slug already taken" lookup (where.slug set, no id) — the latter must
      // resolve to null or `uniqueSlug`'s collision loop never terminates.
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(where?.slug !== undefined ? null : { id: 'rider-1' })
      ),
      findUnique: jest.fn().mockResolvedValue({ id: 'rider-1' }),
      create: jest.fn().mockResolvedValue({ id: 'rider-1' }),
      update: jest.fn().mockResolvedValue({ id: 'rider-1' }),
    },
    rally: {
      findMany: jest.fn().mockResolvedValue([{ id: 'rally-owned-1' }, { id: 'rally-owned-2' }]),
    },
    participantRally: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  return {
    tenant: { id: 'tenant-1' },
    user: {
      id: 'admin-1',
      tenantId: 'tenant-1',
      permissions: ['content:create', 'content:update', 'content:delete'],
      roles: [],
    },
    prisma,
    ...overrides,
  } as any;
}

describe('createParticipant', () => {
  it('rejects rallyIds that do not belong to the tenant', async () => {
    const context = buildContext();
    context.prisma.rally.findMany.mockResolvedValue([{ id: 'rally-owned-1' }]); // only one of two exists

    await expect(
      participantMutations.createParticipant(
        null,
        {
          input: {
            firstName: 'Jane',
            lastName: 'Doe',
            country: 'USA',
            rallyIds: ['rally-owned-1', 'rally-foreign'],
          },
        },
        context
      )
    ).rejects.toThrow(/rallyIds do not belong to this tenant/);

    expect(context.prisma.participant.create).not.toHaveBeenCalled();
  });

  it('creates the participant and links every valid rallyId atomically', async () => {
    const context = buildContext();

    await participantMutations.createParticipant(
      null,
      {
        input: {
          firstName: 'Jane',
          lastName: 'Doe',
          country: 'USA',
          rallyIds: ['rally-owned-1', 'rally-owned-2'],
        },
      },
      context
    );

    expect(context.prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = context.prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(3); // 1 deleteMany + 2 creates
  });
});

describe('updateParticipant', () => {
  it('rejects foreign rallyIds and leaves existing links untouched', async () => {
    const context = buildContext();
    context.prisma.rally.findMany.mockResolvedValue([]); // none owned

    await expect(
      participantMutations.updateParticipant(
        null,
        { id: 'rider-1', input: { rallyIds: ['rally-foreign'] } },
        context
      )
    ).rejects.toThrow(/rallyIds do not belong to this tenant/);

    expect(context.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaces links atomically via a single transaction (delete-all + recreate)', async () => {
    const context = buildContext();

    await participantMutations.updateParticipant(
      null,
      { id: 'rider-1', input: { rallyIds: ['rally-owned-1'] } },
      context
    );

    expect(context.prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = context.prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2); // 1 deleteMany + 1 create
  });

  it('throws Participant not found for an unknown id', async () => {
    const context = buildContext();
    context.prisma.participant.findFirst.mockResolvedValue(null);

    await expect(
      participantMutations.updateParticipant(null, { id: 'missing', input: {} }, context)
    ).rejects.toThrow('Participant not found');
  });
});
