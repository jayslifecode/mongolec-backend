import * as fs from 'fs';
import * as path from 'path';
import { loadRoster } from './team-roster';

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
