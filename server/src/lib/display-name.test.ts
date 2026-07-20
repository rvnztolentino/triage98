import { describe, expect, it } from 'vitest';
import { assertCleanDisplayName, normalizeDisplayName } from './display-name.js';
import { AppError } from './errors.js';

// Built from code points so no invisible literals live in the test source.
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const BELL_CONTROL = String.fromCodePoint(0x07);

describe('normalizeDisplayName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeDisplayName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
  });

  it('strips zero-width and control characters entirely', () => {
    expect(
      normalizeDisplayName(`Ada${ZERO_WIDTH_SPACE}Love${BELL_CONTROL}lace`),
    ).toBe('AdaLovelace');
  });
});

describe('assertCleanDisplayName', () => {
  it('returns the normalized name for a valid input', () => {
    expect(assertCleanDisplayName('  Grace Hopper ')).toBe('Grace Hopper');
  });

  it('rejects names shorter than the minimum', () => {
    expect(() => assertCleanDisplayName('a')).toThrow(AppError);
  });

  it('rejects names longer than the maximum', () => {
    expect(() => assertCleanDisplayName('x'.repeat(81))).toThrow(AppError);
  });

  it('rejects names containing a link', () => {
    expect(() => assertCleanDisplayName('visit http://evil.example')).toThrow(
      AppError,
    );
  });

  it('rejects profanity, including leet-speak evasions', () => {
    expect(() => assertCleanDisplayName('sh1t')).toThrow(AppError);
  });

  it('does not flag clean names that contain a banned substring', () => {
    // "Scunthorpe" problem: token-level matching keeps this clean.
    expect(assertCleanDisplayName('Scunthorpe United')).toBe('Scunthorpe United');
  });
});
