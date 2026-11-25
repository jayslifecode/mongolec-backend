import { GraphQLError } from 'graphql';
import { publicGraphQLError } from '../src/utils/format-graphql-error';
import { AppError, ErrorType } from '../src/types';

const base = { message: 'x', path: ['createStory'], locations: [{ line: 1, column: 1 }] };

function wrap(originalError: Error | undefined, extensions: Record<string, unknown> = {}) {
  return new GraphQLError(originalError?.message ?? 'Variable "$d" got invalid value', {
    originalError,
    extensions,
  });
}

describe('publicGraphQLError (production)', () => {
  it('shows our own errors with their type', () => {
    const error = wrap(
      new AppError('A featured photo is required', ErrorType.VALIDATION_ERROR, 400)
    );
    expect(publicGraphQLError({ ...base, message: error.message }, error, true)).toMatchObject({
      message: 'A featured photo is required',
      code: ErrorType.VALIDATION_ERROR,
    });
  });

  it('shows deliberate plain messages such as "Story with this slug already exists"', () => {
    const error = wrap(new Error('Story with this slug already exists'));
    expect(publicGraphQLError({ ...base, message: error.message }, error, true).message).toBe(
      'Story with this slug already exists'
    );
  });

  it('shows input validation errors so the admin learns which field is wrong', () => {
    const error = wrap(undefined, { code: 'BAD_USER_INPUT' });
    const shown = publicGraphQLError(
      { ...base, message: error.message, extensions: { code: 'BAD_USER_INPUT' } },
      error,
      true
    );
    expect(shown.message).toMatch(/invalid value/);
    expect(shown.code).toBe('BAD_USER_INPUT');
  });

  it('hides programming and database errors', () => {
    const typeError = wrap(new TypeError("Cannot read properties of undefined (reading 'id')"));
    expect(
      publicGraphQLError({ ...base, message: typeError.message }, typeError, true).message
    ).toBe('Internal server error');
    class PrismaClientKnownRequestError extends Error {}
    const dbError = wrap(
      new PrismaClientKnownRequestError('Invalid `prisma.x.update()` invocation')
    );
    expect(publicGraphQLError({ ...base, message: dbError.message }, dbError, true).message).toBe(
      'Internal server error'
    );
  });

  it('shows everything outside production', () => {
    const typeError = wrap(new TypeError('boom'));
    expect(publicGraphQLError({ ...base, message: 'boom' }, typeError, false).message).toBe('boom');
  });
});
