import { normaliseRiderName, riderMergeKey, mergeRiderSightings } from './rider-merge';

describe('normaliseRiderName', () => {
  it('strips a trailing " - YYYY" suffix', () => {
    expect(normaliseRiderName('Wesley Thornberry - 2022')).toBe('Wesley Thornberry');
  });

  it('leaves a plain name untouched', () => {
    expect(normaliseRiderName('Wesley Thornberry')).toBe('Wesley Thornberry');
  });

  it('collapses internal whitespace', () => {
    expect(normaliseRiderName('Wesley   Thornberry')).toBe('Wesley Thornberry');
  });

  it('strips trailing junk after the year suffix', () => {
    expect(normaliseRiderName('Herbert Green - 2022 Bhutan')).toBe('Herbert Green');
  });

  it('handles a missing space before the dash', () => {
    expect(normaliseRiderName('Shawn Lewis- 2022')).toBe('Shawn Lewis');
  });
});

describe('riderMergeKey', () => {
  it('case-folds for matching across sources', () => {
    expect(riderMergeKey('WESLEY THORNBERRY - 2022')).toBe(
      riderMergeKey('wesley thornberry - 2019')
    );
  });
});

describe('mergeRiderSightings', () => {
  it('merges same-person sightings into one record', () => {
    const merged = mergeRiderSightings(
      [
        {
          rawName: 'Wesley Thornberry - 2014',
          bio: 'short',
          rallySlug: 'mongolia-2014',
          year: 2014,
        },
        {
          rawName: 'Wesley Thornberry - 2022',
          bio: 'a much longer bio about Wesley',
          rallySlug: 'bhutan-2022',
          year: 2022,
        },
      ],
      'Mongolia'
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].rallies.size).toBe(2);
  });

  it('keeps the casing of the sighting with the longest bio', () => {
    const merged = mergeRiderSightings(
      [
        { rawName: 'wesley thornberry - 2014', bio: 'x' },
        { rawName: 'Wesley Thornberry - 2022', bio: 'a much longer bio wins the display name' },
      ],
      'Mongolia'
    );
    expect(merged[0].displayName).toBe('Wesley Thornberry');
  });

  it('keeps distinct people separate', () => {
    const merged = mergeRiderSightings(
      [{ rawName: 'Tom Medema' }, { rawName: 'Anna Kim' }],
      'Mongolia'
    );
    expect(merged).toHaveLength(2);
  });

  it('falls back to the default country when no sighting provides one', () => {
    const merged = mergeRiderSightings([{ rawName: 'Jane Doe' }], 'Mongolia');
    expect(merged[0].country).toBe('Mongolia');
  });

  it('fills in a missing photo from a later sighting', () => {
    const merged = mergeRiderSightings(
      [
        { rawName: 'Jane Doe - 2014', photo: null },
        { rawName: 'Jane Doe - 2019', photo: 'https://example.com/jane.jpg' },
      ],
      'Mongolia'
    );
    expect(merged[0].photo).toBe('https://example.com/jane.jpg');
  });

  it('ignores a blank name', () => {
    const merged = mergeRiderSightings([{ rawName: '   ' }], 'Mongolia');
    expect(merged).toHaveLength(0);
  });
});
