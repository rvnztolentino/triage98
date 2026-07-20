import type { AppUser } from '../auth/types.js';

// Augments Express's Request with the authenticated user set by requireAuth /
// optionalAuth. Kept optional so handlers behind requireAuth still narrow it
// explicitly (or rely on requireAuth having guaranteed it).
declare global {
  namespace Express {
    interface Request {
      user?: AppUser;
    }
  }
}

export {};
