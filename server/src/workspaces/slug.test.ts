import { describe, expect, it } from 'vitest';
import {
  SLUG_MAX_LENGTH,
  isValidSlug,
  slugCandidate,
  slugFromName,
} from './slug.js';

describe('slugFromName', () => {
  it('lowercases and hyphenates a normal name', () => {
    expect(slugFromName('Demo Clinic')).toBe('demo-clinic');
  });

  it('collapses runs of punctuation and whitespace into one hyphen', () => {
    expect(slugFromName('  St. Mary’s   Clinic!!  ')).toBe('st-mary-s-clinic');
  });

  it('trims leading and trailing separators', () => {
    expect(slugFromName('---Ops Team---')).toBe('ops-team');
  });

  it('pads a name too short to be a valid slug', () => {
    expect(slugFromName('IT')).toBe('it-workspace');
  });

  it('falls back when nothing usable survives normalization', () => {
    expect(slugFromName('!!!')).toBe('workspace');
    expect(slugFromName('診療所')).toBe('workspace');
  });

  it('leaves room for the disambiguation suffix', () => {
    const slug = slugFromName('a'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH - 4);
  });

  it('always produces a slug the database will accept', () => {
    for (const name of ['Demo Clinic', 'IT', '!!!', '  Ops--Team  ', 'A B C']) {
      expect(isValidSlug(slugFromName(name))).toBe(true);
    }
  });
});

describe('slugCandidate', () => {
  it('uses the bare slug first, then numbered suffixes', () => {
    expect(slugCandidate('demo-clinic', 0)).toBe('demo-clinic');
    expect(slugCandidate('demo-clinic', 1)).toBe('demo-clinic-2');
    expect(slugCandidate('demo-clinic', 19)).toBe('demo-clinic-20');
  });

  it('stays within the database length limit at the last attempt', () => {
    const base = slugFromName('x'.repeat(200));
    expect(isValidSlug(slugCandidate(base, 19))).toBe(true);
  });
});

describe('isValidSlug', () => {
  it('rejects shapes the schema check constraint would reject', () => {
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('Demo-Clinic')).toBe(false);
    expect(isValidSlug('demo--clinic')).toBe(false);
    expect(isValidSlug('-demo')).toBe(false);
    expect(isValidSlug('demo-')).toBe(false);
    expect(isValidSlug('a'.repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});
