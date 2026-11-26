// A plain function, not jest.fn(): the jest config resets mock implementations per test.
jest.mock('../src/libs/file-storage', () => ({
  getPresignedUploadUrl: async (fileType: string) => ({
    uploadUrl: `https://upload.example/${fileType}`,
    fileUrl: 'https://files.example/uploads/x',
  }),
}));

import { uploadResolvers } from '../src/graphql/resolvers/mutations/upload';
import { AppError } from '../src/types';

// Upload links are only handed out for files the sites can show: common web images and
// MP4/WebM video. Anything else (HTML, SVG with scripts, PDFs, executables) is refused.
const createLink = uploadResolvers.Mutation.createPresignedUploadUrl;
const signedIn = { user: { id: 'u1' } } as any;

describe('createPresignedUploadUrl file types', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm'])(
    'hands out a link for %s',
    async fileType => {
      await expect(createLink(null, { fileType }, signedIn)).resolves.toHaveProperty('uploadUrl');
    }
  );

  it.each(['text/html', 'image/svg+xml', 'application/pdf', 'application/x-msdownload', 'video/quicktime', 'IMAGE/JPEG '])(
    'refuses %s with a clear message',
    async fileType => {
      await expect(createLink(null, { fileType }, signedIn)).rejects.toThrow(AppError);
      await expect(createLink(null, { fileType }, signedIn)).rejects.toThrow(/images.*MP4/i);
    }
  );

  it('still refuses logged-out callers', async () => {
    await expect(createLink(null, { fileType: 'image/jpeg' }, { user: null } as any)).rejects.toThrow(
      /Authentication required/
    );
  });
});
