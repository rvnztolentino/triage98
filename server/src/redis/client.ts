import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { withTimeout } from '../lib/timeout.js';

// maxRetriesPerRequest: null keeps commands queued through brief outages instead
// of rejecting, and is the setting a job queue (added later) expects.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

let loggedError = false;
redis.on('error', (err) => {
  // Redis reconnects on its own; log the first error per outage to avoid a flood.
  if (!loggedError) {
    logger.warn({ err }, 'Redis connection error');
    loggedError = true;
  }
});
redis.on('ready', () => {
  loggedError = false;
});

/** Lightweight liveness probe used by the health endpoint; never blocks. */
export async function pingRedis(): Promise<boolean> {
  // With maxRetriesPerRequest: null, a PING issued while disconnected is buffered
  // and can hang indefinitely. Only probe when the connection is actually ready,
  // and still cap the wait so the health endpoint can never block.
  if (redis.status !== 'ready') {
    return false;
  }
  const ping = redis
    .ping()
    .then((reply) => reply === 'PONG')
    .catch((err: unknown) => {
      logger.warn({ err }, 'Redis health check failed');
      return false;
    });
  return withTimeout(ping, 1_500, false);
}
