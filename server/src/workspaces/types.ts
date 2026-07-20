import type { UserRole } from '../auth/types.js';

// Domain shapes returned by the workspace API. Every field is already camelCase —
// the service layer maps snake_case rows once, at the edge of the database.

/** Roles an invite or a role change may assign. Ownership is not transferable in v1. */
export type AssignableRole = Exclude<UserRole, 'owner'>;

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdBy: string | null;
  createdAt: string;
}

/** A workspace as seen by one member — the workspace plus that member's role. */
export interface WorkspaceSummary extends Workspace {
  role: UserRole;
  joinedAt: string;
}

export interface WorkspaceMemberSummary {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  joinedAt: string;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  code: string;
  role: AssignableRole;
  createdBy: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  isReusable: boolean;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
}
