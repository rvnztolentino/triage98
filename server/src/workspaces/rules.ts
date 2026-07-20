import { isAdmin, isOwner } from '../auth/access.js';
import type { UserRole } from '../auth/types.js';
import type { AssignableRole, WorkspaceInvite } from './types.js';

// Membership policy, expressed as pure functions over roles and invite state. Keeping
// these free of database access is deliberate: they are the rules most likely to be
// read during review and the cheapest to test exhaustively. Handlers combine them
// with the access-control choke point (auth/access.ts) — which answers "is this user
// a member, and as what role" — and never re-implement either half inline.

/**
 * True when an invite can still be redeemed. An invite dies on revoke, on expiry,
 * or — for single-use codes — on first redemption. Reusable codes survive use, which
 * is what makes the seeded demo invite work for everyone who clones the repo.
 */
export function isInviteActive(
  invite: Pick<WorkspaceInvite, 'revokedAt' | 'expiresAt' | 'usedAt' | 'isReusable'>,
  at: Date = new Date(),
): boolean {
  if (invite.revokedAt) return false;
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= at.getTime()) {
    return false;
  }
  return invite.isReusable || !invite.usedAt;
}

/**
 * Owners can mint invites at any role; admins can only invite requesters. An admin
 * cannot manufacture a peer, which would otherwise be a one-step privilege escalation
 * out of the role hierarchy.
 */
export function canCreateInvite(
  actorRole: UserRole,
  inviteRole: AssignableRole,
): boolean {
  if (isOwner(actorRole)) return true;
  return actorRole === 'admin' && inviteRole === 'requester';
}

/**
 * Owners can revoke or delete any invite in the workspace; admins only the ones they
 * created themselves — so one admin can't wedge another out of the invite cap, and
 * an admin can always clean up after themselves. Requesters never manage invites.
 */
export function canManageInvite(
  actorRole: UserRole,
  actorUserId: string,
  invite: Pick<WorkspaceInvite, 'createdBy'>,
): boolean {
  if (isOwner(actorRole)) return true;
  if (actorRole !== 'admin') return false;
  return Boolean(invite.createdBy) && invite.createdBy === actorUserId;
}

/**
 * Owners can remove anyone below them; admins can only remove requesters. Nobody can
 * remove an owner — the owner leaves by deleting the workspace.
 */
export function canRemoveMember(
  actorRole: UserRole,
  memberRole: UserRole,
): boolean {
  if (isOwner(memberRole)) return false;
  if (isOwner(actorRole)) return true;
  return isAdmin(actorRole) && memberRole === 'requester';
}

/**
 * Only the owner changes roles, and only for non-owners. Promotion to owner is not
 * offered in v1: a workspace has exactly the owner who created it, so there is no
 * path to two owners or to an orphaned workspace.
 */
export function canUpdateMemberRole(
  actorRole: UserRole,
  memberRole: UserRole,
): boolean {
  return isOwner(actorRole) && !isOwner(memberRole);
}
