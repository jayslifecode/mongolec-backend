import { wordpressPhoto } from './wordpress-photo';

const WP = 'https://rallyforrangers.org/wp-content/uploads/2022/11/Bryon.jpeg';

describe('wordpressPhoto', () => {
  it('uses an already-uploaded copy from the manifest without uploading', async () => {
    const reupload = jest.fn();
    const manifest = {
      'rfr/riders/bryon-majusiak.webp': { url: 'https://b2/bryon.webp', source: WP, width: 900, height: 900 },
    };
    const result = await wordpressPhoto(WP, 'riders', 'bryon-majusiak', manifest, { allowReupload: true, reupload });
    expect(result).toEqual({ url: 'https://b2/bryon.webp', pending: false });
    expect(reupload).not.toHaveBeenCalled();
  });

  it('never uploads during a dry run — it reports the upload as pending instead', async () => {
    const reupload = jest.fn();
    const result = await wordpressPhoto(WP, 'riders', 'new-rider', {}, { allowReupload: false, reupload });
    expect(result).toEqual({ url: null, pending: true });
    expect(reupload).not.toHaveBeenCalled();
  });

  it('uploads when allowed and the manifest has no copy', async () => {
    const reupload = jest.fn().mockResolvedValue('https://b2/new.webp');
    const manifest = {};
    const result = await wordpressPhoto(WP, 'riders', 'new-rider', manifest, { allowReupload: true, reupload });
    expect(reupload).toHaveBeenCalledWith(WP, 'riders', 'new-rider', manifest);
    expect(result).toEqual({ url: 'https://b2/new.webp', pending: false });
  });
});
