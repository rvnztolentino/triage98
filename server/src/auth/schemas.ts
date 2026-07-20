import { z } from 'zod';

// Request-body schemas for the auth routes. Types are derived from the schemas
// (never hand-written in parallel), per the "validate at the boundary" rule.

// Passwords are bounded at 72 bytes because bcrypt silently truncates beyond that;
// rejecting longer input avoids a subtle "part of my password is ignored" footgun.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.');

const emailSchema = z
  .email('Enter a valid email address.')
  .max(320)
  .transform((value) => value.trim().toLowerCase());

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  // Display name is normalized/filtered separately (assertCleanDisplayName); here we
  // only bound the raw length so an oversized payload is rejected before filtering.
  displayName: z.string().min(1).max(200),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Login must not leak password rules, so only require a non-empty string.
  password: z.string().min(1, 'Password is required.'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
