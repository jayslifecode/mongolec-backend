import { applyRiderWrite, planRiderWrite, type ResolvedRider, type RiderWriteClient } from './write-riders';

function rider(slug: string, displayName: string, rallies: string[] = [], extra: Partial<ResolvedRider> = {}): ResolvedRider {
  return {
    key: displayName.toLowerCase().replace(/[^a-z]/g, ''),
    displayName,
    bio: '',
    country: 'Mongolia',
    photo: null,
    rallies: new Map(rallies.map(s => [s, { year: Number(s.slice(-4)), role: 'Rider' }])),
    id: `rfr-rider-${slug}`,
    slug,
    ...extra,
  };
}

/** Records every call so tests can assert the exact write sequence. */
function fakeClient() {
  const calls: Array<{ op: string; args: unknown }> = [];
  const record = (op: string) => async (args: unknown) => {
    calls.push({ op, args });
    return {};
  };
  const client: RiderWriteClient = {
    participant: { deleteMany: record('participant.deleteMany'), upsert: record('participant.upsert') },
    participantRally: { deleteMany: record('link.deleteMany'), create: record('link.create') },
  };
  return { client, calls };
}

describe('planRiderWrite', () => {
  const riders = [rider('graham-cashwell', 'Graham Cashwell'), rider('anna-kim', 'Anna Kim')];

  it('lists stale importer rows with the rider each one merges into', () => {
    const plan = planRiderWrite(
      [
        { id: 'rfr-rider-graham-cashwell', slug: 'graham-cashwell', firstName: 'Graham', lastName: 'Cashwell' },
        { id: 'rfr-rider-graham-cashwell-2024', slug: 'graham-cashwell-2024', firstName: 'Graham', lastName: 'Cashwell 2024' },
        { id: 'rfr-rider-batkhuu-bagvai', slug: 'batkhuu-bagvai', firstName: 'Batkhuu', lastName: 'Bagvai' },
      ],
      riders
    );
    expect(plan.toDelete).toEqual([
      { id: 'rfr-rider-graham-cashwell-2024', name: 'Graham Cashwell 2024', mergedInto: 'rfr-rider-graham-cashwell' },
      { id: 'rfr-rider-batkhuu-bagvai', name: 'Batkhuu Bagvai', mergedInto: null },
    ]);
    expect(plan.collisions).toEqual([]);
  });

  it('reports a non-importer participant that already holds a slug we are about to write', () => {
    const plan = planRiderWrite(
      [{ id: 'ckadmin123', slug: 'anna-kim', firstName: 'Anna', lastName: 'Kim' }],
      riders
    );
    expect(plan.collisions).toEqual([{ id: 'ckadmin123', slug: 'anna-kim', name: 'Anna Kim' }]);
    expect(plan.toDelete).toEqual([]);
  });
});

describe('applyRiderWrite', () => {
  const rallyIdBySlug = new Map([
    ['mongolia-2014', 'r14'],
    ['mongolia-2027', 'r27'],
  ]);

  it('deletes stale rows first, upserts riders (reviving soft-deleted rows) and replaces their links', async () => {
    const { client, calls } = fakeClient();
    const riders = [rider('anne-williams', 'Anne Elizabeth Williams', ['mongolia-2014'])];
    const plan = { toDelete: [{ id: 'rfr-rider-old', name: 'Old', mergedInto: null }], collisions: [] };

    const result = await applyRiderWrite(client, { tenantId: 't1', rallyIdBySlug, riders, plan });

    expect(calls.map(c => c.op)).toEqual([
      'link.deleteMany',
      'participant.deleteMany',
      'participant.upsert',
      'link.deleteMany',
      'link.create',
    ]);
    expect(calls[1].args).toEqual({ where: { id: { in: ['rfr-rider-old'] } } });
    expect(calls[2].args).toMatchObject({
      where: { id: 'rfr-rider-anne-williams' },
      update: { firstName: 'Anne Elizabeth', lastName: 'Williams', deletedAt: null, isActive: true },
      create: { id: 'rfr-rider-anne-williams', tenantId: 't1', displayOrder: 0 },
    });
    expect(calls[3].args).toEqual({ where: { participantId: 'rfr-rider-anne-williams' } });
    expect(calls[4].args).toEqual({
      data: { participantId: 'rfr-rider-anne-williams', rallyId: 'r14', year: 2014, role: 'Rider' },
    });
    expect(result).toEqual({ ridersWritten: 1, linksWritten: 1, deleted: 1 });
  });

  it('keeps explicit first/last names from the master sheet', async () => {
    const { client, calls } = fakeClient();
    const riders = [rider('kent-de-groot', 'Kent De Groot', [], { firstName: 'Kent', lastName: 'De Groot' })];
    await applyRiderWrite(client, { tenantId: 't1', rallyIdBySlug, riders, plan: { toDelete: [], collisions: [] } });
    expect(calls[0].args).toMatchObject({ update: { firstName: 'Kent', lastName: 'De Groot' } });
  });

  it('with managed rallies, only replaces links to those rallies (sheet re-import keeps the rest)', async () => {
    const { client, calls } = fakeClient();
    const riders = [rider('anna-kim', 'Anna Kim', ['mongolia-2014'])];
    await applyRiderWrite(client, {
      tenantId: 't1',
      rallyIdBySlug,
      riders,
      plan: { toDelete: [], collisions: [] },
      managedRallySlugs: new Set(['mongolia-2014']),
    });
    const linkDelete = calls.find(c => c.op === 'link.deleteMany');
    expect(linkDelete?.args).toEqual({ where: { participantId: 'rfr-rider-anna-kim', rallyId: { in: ['r14'] } } });
  });

  it('refuses to write when the plan has slug collisions', async () => {
    const { client, calls } = fakeClient();
    const plan = { toDelete: [], collisions: [{ id: 'ck1', slug: 'anna-kim', name: 'Anna Kim' }] };
    await expect(
      applyRiderWrite(client, { tenantId: 't1', rallyIdBySlug, riders: [rider('anna-kim', 'Anna Kim')], plan })
    ).rejects.toThrow(/slug collision.*anna-kim/i);
    expect(calls).toEqual([]);
  });
});
