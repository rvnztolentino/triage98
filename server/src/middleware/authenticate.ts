import type { NextFunction, Request, Response } from 'express';
import { verifySessionToken } from '../lib/jwt.js';
import { getUserById } from '../auth/service.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { AppUser } from '../auth/types.js';

// Reads the Bearer token, verifies it, and resolves the current user from the
// database on every request. Resolving live (rather than trusting claims wholesale)
// means a deleted user or a changed role takes effect immediately, at the cost of one
// indexed lookup per authenticated request.

function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

async function resolveUser(req: Request): Promise<AppUser | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  return getUserById(claims.userId);
}

/**
 * Requires a valid session. Sets req.user on success; otherwise responds 401 via the
 * central error handler. Every authenticated route sits behind this.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await resolveUser(req);
    if (!user) {
      throw new UnauthorizedError('Authentication required.');
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches req.user when a valid session is present but never rejects the request.
 * For routes that behave differently for signed-in vs anonymous callers.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await resolveUser(req);
    if (user) req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
