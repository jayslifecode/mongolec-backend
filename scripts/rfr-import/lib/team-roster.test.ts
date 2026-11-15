import * as fs from 'fs';
import * as path from 'path';
import { loadRoster, upsertTeamMember } from './team-roster';

const ROSTER_FILE = path.join(__dirname, '..', 'data', 'team-roster.json');

describe('loadRoster (real data/team-roster.json)', () => {
  const roster = loadRoster(fs.readFileSync(ROSTER_FILE, 'utf-8'));

  it('lists the ten members in the client order', () => {
    expect(roster.map(m => m.name)).toEqual([
      'Wesley Thornberry',
      'Tom Medema',
      'Bryon Majusiak',
      'Badral Yondon',
      'Khongorzul Batbayar',
      'Orkhon Tsolmon',
      'Steve Zuschin',
      'Damdindorj “Daimaa” Purvee',
      'Baasandorj “Baaska” Enkhee',
      'Khashbaatar “Khashaa” Davaakhuu',
    ]);
  });

  it('uses the new titles', () => {
    expect(roster[2].role).toBe('Honorary Board Member');
    expect(roster[4].role).toBe('Program Lead');
    expect(roster[5].role).toBe('Field Lead');
    expect(roster[6]).toMatchObject({ name: 'Steve Zuschin', role: 'RfR Ride Leader' });
  });

  it("carries Tom's updated bio", () => {
    expect(roster[1].bio).toContain('35 years');
    expect(roster[1].bio).toContain('KLX300');
  });

  it('sets displayOrder from the array position', () => {
    expect(roster.map(m => m.displayOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('never publishes a placeholder like "XX years"', () => {
    expect(roster.filter(m => /\bXX\b/.test(m.bio))).toEqual([]);
  });
});

describe('loadRoster validation', () => {
  it('throws naming the entry when a role is missing', () => {
    expect(() => loadRoster(JSON.stringify([{ name: 'Jane Doe', bio: '' }]))).toThrow(/entry 1.*role/);
  });

  it('throws when the file is not an array', () => {
    expect(() => loadRoster('{}')).toThrow(/array/);
  });
});

describe('upsertTeamMember', () => {
  const member = { name: 'Tom Medema', role: 'Co-Founder', bio: 'bio', photo: null, displayOrder: 1, isActive: true };

  function fakeClient(existing: { id: string } | null) {
    const calls: Array<{ op: string; args: unknown }> = [];
    const client = {
      teamMember: {
        findFirst: async (args: unknown) => {
          calls.push({ op: 'findFirst', args });
          return existing;
        },
        update: async (args: unknown) => {
          calls.push({ op: 'update', args });
          return {};
        },
        create: async (args: unknown) => {
          calls.push({ op: 'create', args });
          return {};
        },
      },
    };
    return { client, calls };
  }

  it('only matches live (not soft-deleted) rows by name', async () => {
    const { client, calls } = fakeClient(null);
    await upsertTeamMember(client, 't1', member);
    expect(calls[0]).toEqual({ op: 'findFirst', args: { where: { tenantId: 't1', name: 'Tom Medema', deletedAt: null } } });
  });

  it('updates a live row in place and creates otherwise', async () => {
    const live = fakeClient({ id: 'tm1' });
    expect(await upsertTeamMember(live.client, 't1', member)).toBe('updated');
    expect(live.calls[1]).toMatchObject({ op: 'update', args: { where: { id: 'tm1' } } });

    const none = fakeClient(null);
    expect(await upsertTeamMember(none.client, 't1', member)).toBe('created');
    expect(none.calls[1]).toMatchObject({ op: 'create', args: { data: { name: 'Tom Medema', tenantId: 't1' } } });
  });
});
