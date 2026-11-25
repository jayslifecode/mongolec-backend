import type { GraphQLFormattedError } from 'graphql';
import { AppError } from '@/types';

/** GraphQL error codes that describe the caller's input and are safe to show. */
const INPUT_ERROR_CODES = new Set([
  'BAD_USER_INPUT',
  'GRAPHQL_VALIDATION_FAILED',
  'GRAPHQL_PARSE_FAILED',
]);

export interface PublicGraphQLError {
  message: string;
  code: string;
  path?: GraphQLFormattedError['path'];
  locations?: GraphQLFormattedError['locations'];
}

/**
 * What a client may see of an error. In production we show:
 * - our own AppErrors, with their type;
 * - messages thrown on purpose as a plain `Error` ("Story with this slug already exists");
 * - input validation errors, so a form can say which field is wrong.
 * Programming errors (TypeError, ...) and database errors are hidden behind
 * "Internal server error"; they are logged in full by the caller.
 */
export function publicGraphQLError(
  formatted: GraphQLFormattedError,
  error: unknown,
  isProduction: boolean
): PublicGraphQLError {
  const where = { path: formatted.path, locations: formatted.locations };
  const original = (error as { originalError?: unknown } | null)?.originalError;
  const inputCode = formatted.extensions?.code;

  if (original instanceof AppError) {
    return { message: formatted.message, code: original.type, ...where };
  }
  // Apollo may attach its own error object (e.g. ValidationError); the code is what matters.
  if (typeof inputCode === 'string' && INPUT_ERROR_CODES.has(inputCode)) {
    return { message: formatted.message, code: inputCode, ...where };
  }
  const isDeliberate = original instanceof Error && original.constructor === Error;
  if (isProduction && !isDeliberate) {
    return { message: 'Internal server error', code: 'INTERNAL_ERROR', ...where };
  }
  const code = (original as { code?: unknown } | undefined)?.code;
  return {
    message: formatted.message,
    code: typeof code === 'string' ? code : 'UNKNOWN_ERROR',
    ...where,
  };
}
