import { getPresignedUploadUrl, PresignedUrlResponse } from '../../../libs/file-storage';
import { AppError, ErrorType, GraphQLContext } from '../../../types';

/**
 * File types the sites can show. Upload links are public-read, so anything a browser would
 * run or render as a page (HTML, SVG with scripts) or that nothing displays (PDF, .exe,
 * QuickTime) is refused. Video is MP4 or WebM: MP4 plays everywhere, including iPhones.
 */
export const UPLOADABLE_FILE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
]);

export const uploadResolvers = {
  Mutation: {
    createPresignedUploadUrl: async (
      _: any,
      { fileType }: { fileType: string },
      context: GraphQLContext
    ): Promise<PresignedUrlResponse> => {
      if (!context.user) {
        throw new AppError('Authentication required', ErrorType.AUTHENTICATION_ERROR, 401);
      }
      if (!fileType) {
        throw new AppError("A 'fileType' argument is required.", ErrorType.VALIDATION_ERROR, 400);
      }
      if (!UPLOADABLE_FILE_TYPES.has(fileType)) {
        throw new AppError(
          'Only images (JPEG, PNG, WebP, GIF, AVIF) and MP4 or WebM videos can be uploaded.',
          ErrorType.VALIDATION_ERROR,
          400
        );
      }
      return getPresignedUploadUrl(fileType);
    },
  },
};
