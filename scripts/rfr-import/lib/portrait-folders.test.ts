import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isPersonFileStem, scanPortraitFolders } from './portrait-folders';
import { riderMergeKey } from './rider-merge';

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfr-portraits-'));
  const mongolia2015 = path.join(dir, '2015_Mongolia_Ulaan-Taiga');
  const mongolia2024 = path.join(dir, '2024_Mongolia');
  fs.mkdirSync(mongolia2015);
  fs.mkdirSync(mongolia2024);
  fs.writeFileSync(path.join(mongolia2015, 'Batkhuu_Bagvai.jpeg'), '');
  fs.writeFileSync(path.join(mongolia2015, 'Chuck_Flinton.jpeg'), '');
  fs.writeFileSync(path.join(mongolia2024, 'FRF01826.jpg'), '');
  return dir;
}

describe('isPersonFileStem', () => {
  it.each(['FRF01826', 'IMG_1234', 'DSC0001', 'dsc_00042'])('rejects camera filename %s', stem => {
    expect(isPersonFileStem(stem)).toBe(false);
  });

  it.each(['Ali Sarraf', 'Ali_Sarraf', 'Munkh-Ochir_Daariimaa'])('accepts person name %s', stem => {
    expect(isPersonFileStem(stem)).toBe(true);
  });
});

describe('scanPortraitFolders', () => {
  let dir: string;
  beforeAll(() => {
    dir = makeFixture();
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('drops excluded people (rangers) and unnamed camera files', () => {
    const sightings = scanPortraitFolders(dir, {
      excludeKeys: new Set([riderMergeKey('Batkhuu Bagvai')]),
    });
    expect(sightings).toHaveLength(1);
    expect(sightings[0]).toMatchObject({ name: 'Chuck Flinton', rallySlug: 'mongolia-2015' });
  });

  it('still drops camera files when no exclusions are given', () => {
    const names = scanPortraitFolders(dir).map(s => s.name).sort();
    expect(names).toEqual(['Batkhuu Bagvai', 'Chuck Flinton']);
  });
});
