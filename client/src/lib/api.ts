import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export const api = axios.create({
  baseURL,
  timeout: 8000,
});

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
 * Fetches the API health report. The endpoint answers 503 when degraded, so a
 * permissive validateStatus lets us read the well-formed body instead of throwing.
 */
export async function fetchHealth(): Promise<HealthReport> {
  const { data } = await api.get<HealthReport>('/health', {
    validateStatus: (status) => status === 200 || status === 503,
  });
  return data;
}
