import type { NextFunction, Request, Response } from 'express';
import { redis } from '../redis/client.js';
import { logger } from '../lib/logger.js';
import { withTimeout } from '../lib/timeout.js';
import { TooManyRequestsError } from '../lib/errors.js';
import { routeParam } from '../lib/params.js';

// Redis-backed fixed-window rate limiter. A single INCR (plus a first-hit EXPIRE)
// per request keeps it cheap. It deliberately FAILS OPEN: if Redis is unreachable the
// request is allowed rather than blocked, so a cache outage degrades protection but
// never locks users out — consistent with the app's "a dead dependency is not a dead
// app" stance. The counter is the throttle, not a security boundary on its own.

export interface RateLimitOptions {
  /** Namespace for the Redis keys, e.g. 'auth:login'. */
  name: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Derives the per-caller bucket key (e.g. IP, or userId+workspaceId). */
  key: (req: Request) => string;
}

interface WindowState {
  count: number;
  ttl: number;
}

async function hit(
  redisKey: string,
  windowSeconds: number,
): Promise<WindowState | null> {
  // Buffered commands can hang while disconnected (maxRetriesPerRequest: null), so
  // only touch Redis when the connection is actually ready, and still cap the wait.
  if (redis.status !== 'ready') return null;

  const run = (async (): Promise<WindowState> => {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
      return { count, ttl: windowSeconds };
    }
    const ttl = await redis.ttl(redisKey);
    return { count, ttl: ttl > 0 ? ttl : windowSeconds };
  })().catch((err: unknown) => {
    logger.warn({ err, redisKey }, 'Rate limiter Redis error; failing open');
    return null;
  });

  return withTimeout(run, 1_000, null);
}

/** Builds a rate-limiting middleware for the given bucket. */
export function rateLimit(options: RateLimitOptions) {
  const { name, limit, windowSeconds } = options;
  return async function rateLimiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const bucket = options.key(req);
      const state = await hit(`ratelimit:${name}:${bucket}`, windowSeconds);

      // Fail open: Redis unavailable or errored — allow the request through.
      if (!state) {
        next();
        return;
      }

      const remaining = Math.max(0, limit - state.count);
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));

      if (state.count > limit) {
        res.setHeader('Retry-After', String(state.ttl));
        throw new TooManyRequestsError(
          'Too many requests. Please try again later.',
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Bucket key from the caller's IP; used for pre-auth endpoints (login/register). */
export function ipKey(req: Request): string {
  return req.ip ?? 'unknown';
}

/** Bucket key from the authenticated user; used for post-auth mutations. */
export function userKey(req: Request): string {
  return req.user?.id ?? ipKey(req);
}

/**
 * Bucket key scoped to one user in one workspace — the shape admin mutations use, so
 * a burst of edits in one workspace never throttles the same person's work elsewhere.
 * Falls back to the user alone before requireWorkspace has resolved the slug.
 */
export function userWorkspaceKey(req: Request): string {
  return `${userKey(req)}:${workspaceKey(req)}`;
}

/**
 * Bucket key for the whole workspace, regardless of who is calling — the shape a
 * shared-resource ceiling needs (request submissions filling a review queue or a
 * disk), where the limit belongs to the workspace rather than to any one member.
 */
export function workspaceKey(req: Request): string {
  return req.workspace?.id ?? routeParam(req, 'slug') ?? 'none';
}
