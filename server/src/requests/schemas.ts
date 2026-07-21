import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './limits.js';

// Boundary schemas for the request routes. Submissions arrive as multipart/form-data,
// so every field is a string on the wire — these schemas are what turn that into a
// validated shape, and the derived types are the only ones the service layer sees.

export const requestCreateSchema = z.object({
  // The whole product rests on someone describing the problem in their own words, so
  // a floor of 10 characters keeps "printer broken" out of the triage queue.
  description: z
    .string()
    .trim()
    .min(10, 'Describe the issue in at least 10 characters.')
    .max(1200, 'Keep the description under 1,200 characters.'),
  location: z
    .string()
    .trim()
    .min(2, 'Location is required.')
    .max(160, 'Keep the location under 160 characters.'),
  // Defaults to the submitter's display name in the route when left blank.
  contactName: z
    .string()
    .trim()
    .max(80, 'Keep the contact name under 80 characters.')
    .default(''),
  urgencyNote: z
    .string()
    .trim()
    .max(400, 'Keep the urgency note under 400 characters.')
    .default(''),
});

export const requestListQuerySchema = z.object({
  status: z
    .enum(['needs-review', 'approved', 'rejected', 'duplicate'])
    .optional(),
  /** Restricts an admin's view to one requester. Ignored for requesters. */
  requesterUserId: z.uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  // Opaque keyset cursor produced by the previous page.
  cursor: z.string().trim().min(1).max(200).optional(),
});

export type RequestCreateInput = z.infer<typeof requestCreateSchema>;
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;
