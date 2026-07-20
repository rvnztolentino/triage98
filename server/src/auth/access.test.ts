import { describe, expect, it } from 'vitest';
import { hasRoleAtLeast, isAdmin, isOwner } from './access.js';
import type { UserRole } from './types.js';

const ROLES: UserRole[] = ['requester', 'admin', 'owner'];

describe('hasRoleAtLeast', () => {
  it('treats owner as satisfying every minimum', () => {
    for (const min of ROLES) {
      expect(hasRoleAtLeast('owner', min)).toBe(true);
    }
  });

  it('lets a role satisfy its own minimum', () => {
    for (const role of ROLES) {
      expect(hasRoleAtLeast(role, role)).toBe(true);
    }
  });

  it('admin meets requester and admin but not owner', () => {
    expect(hasRoleAtLeast('admin', 'requester')).toBe(true);
    expect(hasRoleAtLeast('admin', 'admin')).toBe(true);
    expect(hasRoleAtLeast('admin', 'owner')).toBe(false);
  });

  it('requester meets only requester', () => {
    expect(hasRoleAtLeast('requester', 'requester')).toBe(true);
    expect(hasRoleAtLeast('requester', 'admin')).toBe(false);
    expect(hasRoleAtLeast('requester', 'owner')).toBe(false);
  });
});

describe('isAdmin', () => {
  it('is true for admin and owner, false for requester', () => {
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('owner')).toBe(true);
    expect(isAdmin('requester')).toBe(false);
  });
});

describe('isOwner', () => {
  it('is true only for owner', () => {
    expect(isOwner('owner')).toBe(true);
    expect(isOwner('admin')).toBe(false);
    expect(isOwner('requester')).toBe(false);
  });
});
