import type { WorkspaceAccess } from '../auth/access.js';
import type { AppUser } from '../auth/types.js';

// Augments Express's Request with the authenticated user set by requireAuth /
// optionalAuth, and the workspace + membership set by requireWorkspace. All kept
// optional so handlers behind the guards still narrow them explicitly (or rely on
// the guard having guaranteed them).
declare global {
  namespace Express {
    interface Request {
      user?: AppUser;
      workspace?: WorkspaceAccess['workspace'];
      membership?: WorkspaceAccess['membership'];
    }
  }
}

export {};
