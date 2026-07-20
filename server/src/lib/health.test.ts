import { describe, expect, it } from 'vitest';
import { summarizeHealth } from './health.js';

describe('summarizeHealth', () => {
  it('reports ok when both dependencies are up', () => {
    expect(summarizeHealth(true, true, 12.7)).toEqual({
      status: 'ok',
      uptimeSeconds: 13,
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('reports degraded when the database is down', () => {
    const report = summarizeHealth(false, true, 5);
    expect(report.status).toBe('degraded');
    expect(report.checks.database).toBe('down');
    expect(report.checks.redis).toBe('up');
  });

  it('reports degraded when redis is down', () => {
    const report = summarizeHealth(true, false, 5);
    expect(report.status).toBe('degraded');
    expect(report.checks.redis).toBe('down');
  });

  it('rounds uptime to whole seconds', () => {
    expect(summarizeHealth(true, true, 1.4).uptimeSeconds).toBe(1);
  });
});
