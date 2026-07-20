import { describe, expect, it } from 'vitest';
import { withTimeout } from './timeout.js';

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'fallback')).resolves.toBe('ok');
  });

  it('resolves with the fallback when the promise rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100, false)).resolves.toBe(
      false,
    );
  });

  it('resolves with the fallback when the promise never settles', async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, 'fallback')).resolves.toBe('fallback');
  });
});
