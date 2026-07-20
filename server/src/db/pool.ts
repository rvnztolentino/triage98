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

/**
 * Runs `fn` inside a transaction on a dedicated client, committing on success and
 * rolling back on any thrown error. Multi-statement invariants (create-with-owner,
 * cap checks that must not race a concurrent writer) go through this rather than
 * issuing separate pool queries that could interleave.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch((rollbackErr: unknown) => {
      logger.error({ err: rollbackErr }, 'Transaction rollback failed');
    });
    throw err;
  } finally {
    client.release();
  }
}

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
