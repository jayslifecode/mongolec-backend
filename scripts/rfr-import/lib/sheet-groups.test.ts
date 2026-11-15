import { parseGroupHeader } from './sheet-groups';

describe('parseGroupHeader', () => {
  it.each([
    ['2024  —  National Parks of Bhutan  (14 riders)', 'bhutan-2024'],
    ['2019  —  National Parks of Western Mongolia  (11 riders)', 'mongolia-2019'],
    ['2023  —  Namibian Rangers  (14 riders)', 'namibia-2023'],
    ['2022  —  National Parks of Peru  (16 riders)', 'peru-2022'],
    ['2025  —  Nam Poui National Protected Area - Laos  (9 riders)', 'laos-2025'],
    ['2014  —  Lake Hovsgol National Park - Mongolia  (12 riders)', 'mongolia-2014'],
    ['2019  —  National Parks - Nepal  (14 riders)', 'nepal-2019'],
  ])('%s -> %s', (header, slug) => {
    expect(parseGroupHeader(header)?.rallySlug).toBe(slug);
  });

  it('returns a null rally slug for "No Rally Assigned"', () => {
    expect(parseGroupHeader('2022  —  No Rally Assigned  (1 riders)')?.rallySlug).toBeNull();
  });

  it('returns null for a line that is not a group header', () => {
    expect(parseGroupHeader('not a header')).toBeNull();
    expect(parseGroupHeader('UNASSIGNED  —  No Rally Assigned  (54 riders)')).toBeNull();
  });

  it('exposes year, park label and title-cased country', () => {
    expect(parseGroupHeader('2024  —  National Parks of Bhutan  (14 riders)')).toEqual({
      year: 2024,
      label: 'National Parks of Bhutan',
      park: 'National Parks of Bhutan',
      country: 'Bhutan',
      rallySlug: 'bhutan-2024',
    });
    expect(parseGroupHeader('2025  —  Nam Poui National Protected Area - Laos  (9 riders)')).toEqual({
      year: 2025,
      label: 'Nam Poui National Protected Area - Laos',
      park: 'Nam Poui National Protected Area',
      country: 'Laos',
      rallySlug: 'laos-2025',
    });
  });
});
