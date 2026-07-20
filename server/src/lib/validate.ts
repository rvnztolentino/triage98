import { z, type ZodType } from 'zod';
import { BadRequestError } from './errors.js';

/**
 * Parses `data` against a zod schema, throwing BadRequestError (400) with per-field
 * messages on failure. The single boundary-validation entry point for route handlers.
 */
export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestError(
      'Validation failed.',
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
