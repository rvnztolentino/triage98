import { z } from 'zod';
import { DEFAULT_INVITE_TTL_DAYS } from './limits.js';

// Boundary schemas for the workspace routes. Types are derived from the schemas, per
// the "validate at the boundary" rule — no hand-written parallel interfaces.

export const workspaceCreateSchema = z.object({
  // Only the raw length is bounded here; the name is normalized and filtered by
  // assertCleanName in the route, the same way registration handles display names.
  name: z.string().min(1).max(200),
});

// Department ids are slugs and double as the stable key referenced by tickets and
// triage results, so they are constrained the same way workspace slugs are.
const departmentIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers, and single hyphens.',
  );

export const departmentCreateSchema = z.object({
  id: departmentIdSchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).default(''),
});

// Every field optional, but at least one required — a PATCH with an empty body is a
// client bug, not a no-op worth pretending succeeded.
export const departmentUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(400).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    'Provide a name or a description to update.',
  );

export const inviteCreateSchema = z.object({
  // Owners may invite admins; the route enforces that via canCreateInvite.
  role: z.enum(['requester', 'admin']).default('requester'),
  // Single-use by default: the safer choice for a code that grants workspace access.
  isReusable: z.boolean().default(false),
  // 0 means "never expires"; anything else is a lifetime in days.
  expiresInDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(365)
    .default(DEFAULT_INVITE_TTL_DAYS),
});

export const inviteRedeemSchema = z.object({
  // Accepts a bare code or a full invite link; normalizeInviteCode sorts it out.
  code: z.string().trim().min(1).max(500),
});

export const memberRoleUpdateSchema = z.object({
  role: z.enum(['requester', 'admin']),
});

export const workspaceDeleteSchema = z.object({
  // Deleting cascades to every request, ticket, and note in the workspace, so the
  // caller has to retype the slug. Irreversible actions should be hard to fat-finger.
  confirmation: z.string().trim(),
});

export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;
export type MemberRoleUpdateInput = z.infer<typeof memberRoleUpdateSchema>;
