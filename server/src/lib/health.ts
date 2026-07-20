export type DependencyState = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: {
    database: DependencyState;
    redis: DependencyState;
  };
}

/**
 * Pure summary of a health probe. Kept dependency-free so it can be unit tested
 * without a live database or Redis. The API is 'ok' only when every dependency is
 * reachable; otherwise it is 'degraded' (surfaced as HTTP 503).
 */
export function summarizeHealth(
  databaseUp: boolean,
  redisUp: boolean,
  uptimeSeconds: number,
): HealthReport {
  return {
    status: databaseUp && redisUp ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(uptimeSeconds),
    checks: {
      database: databaseUp ? 'up' : 'down',
      redis: redisUp ? 'up' : 'down',
    },
  };
}
