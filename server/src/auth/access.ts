import { pool } from '../db/pool.js';
import { ForbiddenError } from '../lib/errors.js';
import type { UserRole } from './types.js';

// THE access-control choke point. Every query path that touches workspace-scoped data
// must resolve access through this module — membership and role are checked here, in
// application code, never sprinkled across handlers and never delegated to the
// database (there is no RLS by design). Later branches build their guards on top of
// these functions rather than re-querying workspace_members themselves.

// Role hierarchy: a higher rank implies every lower capability. owner ⊃ admin ⊃
// requester. Comparisons go through hasRoleAtLeast so the ordering lives in one place.
const ROLE_RANK: Record<UserRole, number> = {
  requester: 1,
  admin: 2,
  owner: 3,
};

/** True when `role` is at least as privileged as `minimum`. */
export function hasRoleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** True for admin or owner. */
export function isAdmin(role: UserRole): boolean {
  return hasRoleAtLeast(role, 'admin');
}

/** True for owner only. */
export function isOwner(role: UserRole): boolean {
  return role === 'owner';
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: UserRole;
}

function normalizeRole(role: string): UserRole {
  return role === 'owner' || role === 'admin' ? role : 'requester';
}

/**
 * Returns the user's membership in a workspace, or null if they are not a member.
 * This is the single source of truth for "is this user in this workspace, and as
 * what role" — workspace_members.role is authoritative, not users.role.
 */
export async function getMembership(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMembership | null> {
  const { rows } = await pool.query<{ role: string }>(
    `select role from workspace_members
      where workspace_id = $1 and user_id = $2`,
    [workspaceId, userId],
  );
  const row = rows[0];
  return row
    ? { workspaceId, userId, role: normalizeRole(row.role) }
    : null;
}

/**
 * Resolves membership and throws ForbiddenError if the user is not a member. Use this
 * (or one of the role-specific wrappers below) at the top of every workspace-scoped
 * handler before reading or writing workspace data.
 */
export async function requireMembership(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMembership> {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) {
    throw new ForbiddenError('You do not have access to this workspace.');
  }
  return membership;
}

/**
 * Resolves membership and enforces a minimum role, throwing ForbiddenError when the
 * user is not a member or lacks the required role.
 */
export async function requireRole(
  workspaceId: string,
  userId: string,
  minimum: UserRole,
): Promise<WorkspaceMembership> {
  const membership = await requireMembership(workspaceId, userId);
  if (!hasRoleAtLeast(membership.role, minimum)) {
    throw new ForbiddenError('You do not have permission to do this.');
  }
  return membership;
}

/** Requires admin (or owner) membership in the workspace. */
export function requireWorkspaceAdmin(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMembership> {
  return requireRole(workspaceId, userId, 'admin');
}

/** Requires owner membership in the workspace. */
export function requireWorkspaceOwner(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMembership> {
  return requireRole(workspaceId, userId, 'owner');
}
