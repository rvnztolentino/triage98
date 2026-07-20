import { describe, expect, it } from 'vitest';
import { AppError } from '../lib/errors.js';
import { generateInviteCode, normalizeInviteCode } from './invite-code.js';

describe('generateInviteCode', () => {
  it('produces a grouped, uppercase code', () => {
    expect(generateInviteCode()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('avoids the characters people misread', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateInviteCode()).not.toMatch(/[01ILO]/);
    }
  });

  it('does not repeat itself across a batch', () => {
    const codes = new Set(
      Array.from({ length: 500 }, () => generateInviteCode()),
    );
    expect(codes.size).toBe(500);
  });

  it('round-trips through normalization unchanged', () => {
    const code = generateInviteCode();
    expect(normalizeInviteCode(code)).toBe(code);
  });
});

describe('normalizeInviteCode', () => {
  it('uppercases and trims a hand-typed code', () => {
    expect(normalizeInviteCode('  k7q2-m4xr-9tbf ')).toBe('K7Q2-M4XR-9TBF');
  });

  it('accepts the seeded demo code', () => {
    expect(normalizeInviteCode('DEMO-CLINIC-2026')).toBe('DEMO-CLINIC-2026');
  });

  it('extracts the code from a pasted invite link', () => {
    expect(
      normalizeInviteCode('http://localhost:5173/join?code=K7Q2-M4XR-9TBF'),
    ).toBe('K7Q2-M4XR-9TBF');
  });

  it('extracts the code when other query parameters follow', () => {
    expect(
      normalizeInviteCode('/join?ref=email&code=K7Q2-M4XR-9TBF&utm=x'),
    ).toBe('K7Q2-M4XR-9TBF');
  });

  it('rejects malformed input with a 400', () => {
    for (const input of ['', 'short', 'has spaces', 'double--hyphen', '-lead']) {
      expect(() => normalizeInviteCode(input)).toThrowError(AppError);
      try {
        normalizeInviteCode(input);
      } catch (err) {
        expect((err as AppError).status).toBe(400);
      }
    }
  });
});
