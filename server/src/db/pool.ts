import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { withTimeout } from '../lib/timeout.js';

// A single shared pool for the process. Every query path goes through this.
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  // Fail fast when Postgres is unreachable rather than waiting on the TCP connect.
  connectionTimeoutMillis: 3_000,
});

pool.on('error', (err) => {
  // Errors on idle clients would otherwise crash the process.
  logger.error({ err }, 'Unexpected error on idle Postgres client');
});

/** Lightweight liveness probe used by the health endpoint; never blocks. */
export async function pingDatabase(): Promise<boolean> {
  const query = pool
    .query<{ ok: number }>('select 1 as ok')
    .then((result) => result.rows[0]?.ok === 1)
    .catch((err: unknown) => {
      logger.warn({ err }, 'Database health check failed');
      return false;
    });
  return withTimeout(query, 3_000, false);
}
