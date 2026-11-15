import { buildBucketIndex, matchPortrait } from './photo-match';
import type { Manifest } from './manifest';

const entry = (url: string) => ({ url, source: 'x', width: 900, height: 900 });
const manifest: Manifest = {
  'rfr/riders/anna-louise-emrich.webp': entry('https://b2/anna-louise.webp'),
  'rfr/riders/wesley-thornberry.webp': entry('https://b2/wesley.webp'),
  'rfr/rangers/munkh-ochir-daariimaa.webp': entry('https://b2/munkh-ochir.webp'),
};

describe('matchPortrait', () => {
  const riders = buildBucketIndex(manifest, 'riders');

  it('matches a plain name', () => {
    expect(matchPortrait('Wesley Thornberry', riders)).toBe('https://b2/wesley.webp');
  });

  it('matches a hyphenated first name to its kebab-case key', () => {
    expect(matchPortrait('Anna-Louise Emrich', riders)).toBe('https://b2/anna-louise.webp');
  });

  it('matches a hyphenated first name in another bucket', () => {
    expect(matchPortrait('Munkh-Ochir Daariimaa', buildBucketIndex(manifest, 'rangers'))).toBe(
      'https://b2/munkh-ochir.webp'
    );
  });

  it('returns null for an unknown person', () => {
    expect(matchPortrait('Jane Doe', riders)).toBeNull();
  });
});
