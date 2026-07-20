import { describe, expect, it } from 'vitest';
import {
  canCreateInvite,
  canManageInvite,
  canRemoveMember,
  canUpdateMemberRole,
  isInviteActive,
} from './rules.js';

const OWNER = 'owner-user';
const ADMIN = 'admin-user';

function invite(overrides: Partial<{
  revokedAt: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  isReusable: boolean;
}> = {}) {
  return {
    revokedAt: null,
    expiresAt: null,
    usedAt: null,
    isReusable: false,
    ...overrides,
  };
}

describe('isInviteActive', () => {
  const now = new Date('2026-07-20T12:00:00Z');

  it('accepts a fresh, unused, non-expiring invite', () => {
    expect(isInviteActive(invite(), now)).toBe(true);
  });

  it('rejects a revoked invite even when otherwise valid', () => {
    expect(
      isInviteActive(invite({ revokedAt: '2026-07-19T00:00:00Z' }), now),
    ).toBe(false);
  });

  it('rejects an expired invite', () => {
    expect(
      isInviteActive(invite({ expiresAt: '2026-07-20T11:59:59Z' }), now),
    ).toBe(false);
  });

  it('accepts an invite whose expiry is still in the future', () => {
    expect(
      isInviteActive(invite({ expiresAt: '2026-07-20T12:00:01Z' }), now),
    ).toBe(true);
  });

  it('burns a single-use invite once redeemed', () => {
    expect(
      isInviteActive(invite({ usedAt: '2026-07-19T00:00:00Z' }), now),
    ).toBe(false);
  });

  it('keeps a reusable invite alive after use', () => {
    expect(
      isInviteActive(
        invite({ usedAt: '2026-07-19T00:00:00Z', isReusable: true }),
        now,
      ),
    ).toBe(true);
  });

  it('rejects a reusable invite once revoked', () => {
    expect(
      isInviteActive(
        invite({ isReusable: true, revokedAt: '2026-07-19T00:00:00Z' }),
        now,
      ),
    ).toBe(false);
  });
});

describe('canCreateInvite', () => {
  it('lets an owner invite at any role', () => {
    expect(canCreateInvite('owner', 'admin')).toBe(true);
    expect(canCreateInvite('owner', 'requester')).toBe(true);
  });

  it('stops an admin from minting another admin', () => {
    expect(canCreateInvite('admin', 'requester')).toBe(true);
    expect(canCreateInvite('admin', 'admin')).toBe(false);
  });

  it('never lets a requester invite', () => {
    expect(canCreateInvite('requester', 'requester')).toBe(false);
    expect(canCreateInvite('requester', 'admin')).toBe(false);
  });
});

describe('canManageInvite', () => {
  it('lets an owner manage any invite', () => {
    expect(canManageInvite('owner', OWNER, { createdBy: ADMIN })).toBe(true);
    expect(canManageInvite('owner', OWNER, { createdBy: null })).toBe(true);
  });

  it('limits an admin to their own invites', () => {
    expect(canManageInvite('admin', ADMIN, { createdBy: ADMIN })).toBe(true);
    expect(canManageInvite('admin', ADMIN, { createdBy: OWNER })).toBe(false);
    expect(canManageInvite('admin', ADMIN, { createdBy: null })).toBe(false);
  });

  it('never lets a requester manage invites', () => {
    expect(canManageInvite('requester', ADMIN, { createdBy: ADMIN })).toBe(
      false,
    );
  });
});

describe('canRemoveMember', () => {
  it('never allows removing an owner', () => {
    expect(canRemoveMember('owner', 'owner')).toBe(false);
    expect(canRemoveMember('admin', 'owner')).toBe(false);
    expect(canRemoveMember('requester', 'owner')).toBe(false);
  });

  it('lets an owner remove admins and requesters', () => {
    expect(canRemoveMember('owner', 'admin')).toBe(true);
    expect(canRemoveMember('owner', 'requester')).toBe(true);
  });

  it('lets an admin remove only requesters', () => {
    expect(canRemoveMember('admin', 'requester')).toBe(true);
    expect(canRemoveMember('admin', 'admin')).toBe(false);
  });

  it('never lets a requester remove anyone', () => {
    expect(canRemoveMember('requester', 'requester')).toBe(false);
  });
});

describe('canUpdateMemberRole', () => {
  it('is owner-only', () => {
    expect(canUpdateMemberRole('owner', 'requester')).toBe(true);
    expect(canUpdateMemberRole('owner', 'admin')).toBe(true);
    expect(canUpdateMemberRole('admin', 'requester')).toBe(false);
    expect(canUpdateMemberRole('requester', 'requester')).toBe(false);
  });

  it('refuses to demote an owner', () => {
    expect(canUpdateMemberRole('owner', 'owner')).toBe(false);
  });
});
