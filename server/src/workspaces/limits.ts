import { ForbiddenError } from '../lib/errors.js';

// Bounded growth, deliberately. Triage98 runs on someone's laptop or a small box, so
// every unbounded list is a footgun: caps keep row counts, notification fan-out, and
// invite tables predictable. The numbers are ported from the reference, where they
// were tuned against a free-tier budget; they are generous for a single team.

/** Max workspaces one user may own. */
export const MAX_WORKSPACES_PER_USER = 3;

/** Max members in a single workspace, owner included. */
export const MAX_WORKSPACE_MEMBERS = 20;

/** Max invites outstanding (not used, revoked, or expired) per workspace at once. */
export const MAX_ACTIVE_INVITES = 5;

/** Max custom (non-default) departments per workspace. Defaults don't count. */
export const MAX_CUSTOM_DEPARTMENTS = 10;

/** Default invite lifetime when the caller doesn't pick one. */
export const DEFAULT_INVITE_TTL_DAYS = 7;

// The seeded demo workspace (db/init/02_seed.sql). It exists so a fresh clone has
// something to look at, which also means anyone can join it — so it is read-only:
// mutations are rejected and real work happens in a workspace the user creates.
export const DEMO_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_WORKSPACE_SLUG = 'demo-clinic';
const DEMO_LOCK_MESSAGE =
  'Demo Clinic is a read-only preview workspace. Create your own workspace to make changes.';

/**
 * Departments every new workspace starts with. Kept in sync with the seed SQL so a
 * created workspace and the demo workspace behave identically. These are also the
 * departments that cannot be deleted — triage always needs somewhere to route to.
 */
export const DEFAULT_DEPARTMENTS = [
  {
    id: 'it',
    name: 'IT',
    description: 'Network, devices, software, projectors, printers, accounts.',
  },
  {
    id: 'facilities',
    name: 'Facilities',
    description: 'General building operations and space coordination.',
  },
  {
    id: 'maintenance',
    name: 'Maintenance',
    description: 'HVAC, leaks, electrical, plumbing, repairs.',
  },
  {
    id: 'security',
    name: 'Security',
    description: 'Access control, doors, gates, badges, incidents.',
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Records, scheduling, office supplies, front desk operations.',
  },
  {
    id: 'clinic',
    name: 'Clinic / Health',
    description:
      'Patient areas, health concerns, medical rooms, clinical workflow support.',
  },
] as const;

export const DEFAULT_DEPARTMENT_IDS: readonly string[] =
  DEFAULT_DEPARTMENTS.map((department) => department.id);

/** True for a department every workspace ships with (not deletable, not capped). */
export function isDefaultDepartment(id: string): boolean {
  return DEFAULT_DEPARTMENT_IDS.includes(id);
}

/** True for the seeded, read-only demo workspace. */
export function isPreviewWorkspace(workspaceId: string): boolean {
  return workspaceId === DEMO_WORKSPACE_ID;
}

/** Rejects mutations against the read-only demo workspace. */
export function assertWorkspaceMutable(workspaceId: string): void {
  if (isPreviewWorkspace(workspaceId)) {
    throw new ForbiddenError(DEMO_LOCK_MESSAGE);
  }
}
