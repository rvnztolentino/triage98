import type { NextFunction, Request, Response } from 'express';
import { requireWorkspaceAccess } from '../auth/access.js';
import { UnauthorizedError } from '../lib/errors.js';
import { routeParam } from '../lib/params.js';
import type { UserRole } from '../auth/types.js';

// Turns the `:slug` route parameter into a verified workspace on the request. Sitting
// between requireAuth and the handler, it guarantees that by the time any
// workspace-scoped handler runs, membership and the minimum role have already been
// checked through the access-control choke point — a handler never sees a workspace
// id it hasn't been cleared for, and never performs its own membership query.

/**
 * Requires an authenticated member of the workspace named by `:slug`, at `minimum`
 * role or above. Sets req.workspace and req.membership.
 */
export function requireWorkspace(minimum: UserRole = 'requester') {
  return async function workspaceGuard(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        // Only reachable if a route forgets requireAuth; fail closed rather than
        // resolving access for an anonymous caller.
        throw new UnauthorizedError('Authentication required.');
      }
      const access = await requireWorkspaceAccess(
        routeParam(req, 'slug'),
        user.id,
        minimum,
      );
      req.workspace = access.workspace;
      req.membership = access.membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}
