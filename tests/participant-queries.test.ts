import { participantQueries } from '../src/graphql/resolvers/queries/participant';
import { resolvers } from '../src/graphql/resolvers';

const Participant = (resolvers as any).Participant;

function participantFixture() {
  return {
    id: 'rider-1',
    firstName: 'Wesley',
    lastName: 'Thornberry',
    slug: 'wesley-thornberry',
    rallies: [
      {
        year: 2024,
        role: 'Rider',
        rally: {
          id: 'rally-1',
          slug: 'mongolia-2024',
          status: 'COMPLETED',
          stories: [
            { slug: 'mongolia-2024', status: 'PUBLISHED' },
            { slug: 'mongolia-2024-draft', status: 'DRAFT' },
          ],
        },
      },
    ],
    _count: { rallies: 1 },
  };
}

function buildContext(participant: any, user: any = null) {
  return {
    tenant: { id: 'tenant-1' },
    user,
    prisma: {
      participant: {
        findFirst: jest.fn().mockResolvedValue(participant),
      },
    },
  } as any;
}

describe('getParticipant', () => {
  it('looks up by slug when provided', async () => {
    const context = buildContext(participantFixture());
    await participantQueries.getParticipant(null, { slug: 'wesley-thornberry' }, context);
    const [{ where }] = context.prisma.participant.findFirst.mock.calls[0];
    expect(where.slug).toBe('wesley-thornberry');
  });

  it('returns null when nothing matches', async () => {
    const context = buildContext(null);
    const result = await participantQueries.getParticipant(null, { id: 'missing' }, context);
    expect(result).toBeNull();
  });

  it('throws when neither slug nor id is provided', async () => {
    const context = buildContext(null);
    await expect(participantQueries.getParticipant(null, {}, context)).rejects.toThrow(
      'Either slug or id must be provided'
    );
  });
});

describe('Participant.rallies field resolver — story visibility', () => {
  it('hides DRAFT stories for anonymous callers', async () => {
    const context = buildContext(null); // user: null => anonymous
    const links = await Participant.rallies(participantFixture(), {}, context);
    expect(links[0].rally.stories).toEqual([{ slug: 'mongolia-2024', status: 'PUBLISHED' }]);
  });

  it('shows all stories (including DRAFT) for authenticated callers', async () => {
    const context = buildContext(null, { id: 'admin-1' });
    const links = await Participant.rallies(participantFixture(), {}, context);
    expect(links[0].rally.stories).toHaveLength(2);
  });
});

describe('Participant.tier / rallyCount field resolvers', () => {
  it('computes tier from the loaded rally count', () => {
    const p = { _count: { rallies: 9 } };
    expect(Participant.rallyCount(p)).toBe(9);
    expect(Participant.tier(p)).toBe('LEGEND');
  });
});
