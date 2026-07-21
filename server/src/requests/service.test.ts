import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './service.js';

// The cursor is the one piece of the service layer with logic worth testing without a
// database: it is round-tripped through an untrusted client, so it has to survive its
// own encoding and reject anything else.

describe('list cursors', () => {
  const createdAt = '2026-07-20T09:15:30.123Z';

  it('round-trips a sort key', () => {
    const cursor = encodeCursor(createdAt, 'REQ-1042');
    expect(decodeCursor(cursor)).toEqual({ createdAt, id: 'REQ-1042' });
  });

  it('is opaque and URL-safe', () => {
    const cursor = encodeCursor(createdAt, 'REQ-1042');
    expect(cursor).not.toContain('REQ-1042');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  it('rejects rather than mis-parses an id containing the separator', () => {
    // Request ids never contain a pipe, so this can only come from a tampered
    // cursor. Splitting from the right would leave a corrupted timestamp, and
    // failing the date check is what turns that into a 400 instead of a bad page.
    expect(() => decodeCursor(encodeCursor(createdAt, 'REQ-1|1'))).toThrow(
      /cursor/i,
    );
  });

  it('rejects a cursor that is not one of ours', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(/cursor/i);
    expect(() => decodeCursor(encodeCursor('nonsense', 'REQ-1'))).toThrow(
      /cursor/i,
    );
    expect(() =>
      decodeCursor(Buffer.from('|REQ-1', 'utf8').toString('base64url')),
    ).toThrow(/cursor/i);
    expect(() =>
      decodeCursor(Buffer.from(`${createdAt}|`, 'utf8').toString('base64url')),
    ).toThrow(/cursor/i);
  });
});
