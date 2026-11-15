import { fromSheetRows, mergeSheetRiders, toSheetRows, SHEET_FIXED_HEADERS } from './rider-sheet';

describe('mergeSheetRiders', () => {
  const existing = [
    {
      firstName: 'André',
      lastName: 'Angelantoni',
      bio: 'Andre bio',
      photo: 'https://cdn/andre.webp',
      country: 'USA',
    },
  ];

  it('keeps bio, photo and country from the existing row matched by merge key', () => {
    const [rider] = mergeSheetRiders(
      [{ firstName: 'Andre', lastName: 'Angelantoni', rallySlugs: ['mongolia-2015'] }],
      existing,
      'Mongolia'
    );
    expect(rider).toMatchObject({
      displayName: 'Andre Angelantoni',
      firstName: 'Andre',
      lastName: 'Angelantoni',
      bio: 'Andre bio',
      photo: 'https://cdn/andre.webp',
      country: 'USA',
    });
    expect(Array.from(rider.rallies.entries())).toEqual([
      ['mongolia-2015', { year: 2015, role: 'Rider' }],
    ]);
  });

  it('throws when the sheet lists the same person twice', () => {
    expect(() =>
      mergeSheetRiders(
        [
          { firstName: 'André', lastName: 'Angelantoni', rallySlugs: [] },
          { firstName: 'Andre', lastName: 'Angelantoni', rallySlugs: [] },
        ],
        [],
        'Mongolia'
      )
    ).toThrow(/Andre Angelantoni.*André Angelantoni|André Angelantoni.*Andre Angelantoni/);
  });

  it('gives a new name an empty bio, no photo and the default country', () => {
    const [rider] = mergeSheetRiders(
      [{ firstName: 'Jane', lastName: 'Doe', rallySlugs: [] }],
      existing,
      'Mongolia'
    );
    expect(rider).toMatchObject({ bio: '', photo: null, country: 'Mongolia' });
    expect(rider.rallies.size).toBe(0);
  });
});

const rallies = [
  { slug: 'mongolia-2014', title: 'Mongolia 2014' },
  { slug: 'argentina-2018', title: 'Argentina 2018' },
  { slug: 'bhutan-2024', title: 'Bhutan 2024' },
];
const rallyKey = new Map(rallies.map(r => [r.title, r.slug]));

const sample = [
  { firstName: 'Lester', lastName: 'Appel', rallySlugs: ['mongolia-2014', 'bhutan-2024'] },
  { firstName: 'Martin', lastName: '', rallySlugs: ['argentina-2018'] },
  { firstName: 'Jane', lastName: 'Doe', rallySlugs: [] },
];

describe('toSheetRows', () => {
  it('writes the fixed headers then one column per rally', () => {
    const [header] = toSheetRows(sample, rallies);
    expect(header).toEqual([...SHEET_FIXED_HEADERS, 'Mongolia 2014', 'Argentina 2018', 'Bhutan 2024']);
  });

  it('marks attended rallies with x and derives count and countries', () => {
    const rows = toSheetRows(sample, rallies);
    expect(rows[1]).toEqual(['Appel', 'Lester', '2', 'Mongolia, Bhutan', 'x', '', 'x']);
  });
});

describe('fromSheetRows', () => {
  it('round-trips toSheetRows', () => {
    expect(fromSheetRows(toSheetRows(sample, rallies), rallyKey)).toEqual(sample);
  });

  it('counts an "X " cell as attended (case and whitespace insensitive)', () => {
    const rows = [
      [...SHEET_FIXED_HEADERS, 'Mongolia 2014'],
      ['Appel', 'Lester', '', '', 'X '],
    ];
    expect(fromSheetRows(rows, rallyKey)[0].rallySlugs).toEqual(['mongolia-2014']);
  });

  it('skips blank rows', () => {
    const rows = [[...SHEET_FIXED_HEADERS, 'Mongolia 2014'], ['', '', '', '', ''], ['Appel', 'Lester', '', '', 'x']];
    expect(fromSheetRows(rows, rallyKey)).toHaveLength(1);
  });

  it('throws naming row 1 when a rally column is not in the rally key', () => {
    const rows = [[...SHEET_FIXED_HEADERS, 'Black Hills 2024'], ['Appel', 'Lester', '', '', 'x']];
    expect(() => fromSheetRows(rows, rallyKey)).toThrow(/row 1/);
  });

  it('throws naming the row when a marked row has no name', () => {
    const rows = [[...SHEET_FIXED_HEADERS, 'Mongolia 2014'], ['Appel', 'Lester', '', '', 'x'], ['', '', '', '', 'x']];
    expect(() => fromSheetRows(rows, rallyKey)).toThrow(/row 3/);
  });
});
