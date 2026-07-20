import { z, type ZodType } from 'zod';
import { BadRequestError } from './errors.js';

/**
 * Parses `data` against a zod schema, throwing BadRequestError (400) with per-field
 * messages on failure. The single boundary-validation entry point for route handlers.
 */
export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const { fieldErrors, formErrors } = z.flattenError(result.error);
    // Object-level refinements (e.g. "provide at least one field") produce form
    // errors rather than field errors, so promote the first one to the message —
    // otherwise the client gets a bare "Validation failed." with nothing to show.
    throw new BadRequestError(
      formErrors[0] ?? 'Validation failed.',
      formErrors.length > 0 ? { fieldErrors, formErrors } : fieldErrors,
    );
  }
  return result.data;
}
