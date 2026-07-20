import { BadRequestError } from './errors.js';

// Account display names are user-editable and shown to other workspace members, so
// they run through this shared filter before being saved. It normalizes the input,
// blocks control/zero-width tricks and links, restricts the length, and rejects a
// small set of obviously offensive words. Ported (trimmed) from the reference; the
// rolling name-change throttle lives with the profile feature, not here.

const MIN_LENGTH = 2;
const MAX_LENGTH = 80;

// Leet-speak substitutions so "sh1t" / "f_u_c_k" style evasions still match. Kept
// deliberately small; this is a lightweight guardrail, not exhaustive moderation.
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '8': 'b',
};

const PROFANITY = new Set([
  'fuck',
  'fucker',
  'fucking',
  'shit',
  'bitch',
  'cunt',
  'asshole',
  'dick',
  'bastard',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'whore',
  'slut',
  'rape',
  'rapist',
]);

// True for C0/C1 control characters, the soft hyphen, and zero-width / invisible
// formatting characters that can smuggle content past filters or spoof how a name
// renders. Matched by code point so no invisible literals live in the source.
function isInvisibleCodePoint(code: number): boolean {
  return (
    code <= 0x1f ||
    code === 0x7f ||
    code === 0xad ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x2060 ||
    code === 0xfeff
  );
}

// Reduces a single token to bare letters after applying leet substitutions, so
// profanity checks compare like-for-like against the word list.
function canonicalizeToken(token: string): string {
  return token
    .toLowerCase()
    .split('')
    .map((char) => LEET[char] ?? char)
    .join('')
    .replace(/[^a-z]/g, '');
}

/**
 * Trims, unifies unicode width/compat forms, strips control + zero-width characters,
 * and collapses runs of whitespace to a single space.
 */
export function normalizeDisplayName(raw: string): string {
  const stripped = Array.from(raw.normalize('NFKC'))
    .filter((char) => !isInvisibleCodePoint(char.codePointAt(0) ?? 0))
    .join('');
  return stripped.replace(/\s+/g, ' ').trim();
}

// Flags a name when any whitespace-separated token canonicalizes to a listed slur.
// Token-level matching (rather than substring) avoids the "Scunthorpe" problem where
// clean names contain a banned sequence.
function containsProfanity(value: string): boolean {
  return value.split(/\s+/).some((token) => {
    const canonical = canonicalizeToken(token);
    return canonical.length > 0 && PROFANITY.has(canonical);
  });
}

export interface CleanNameOptions {
  /** How the field is described in error messages, e.g. 'Workspace name'. */
  label?: string;
  minLength?: number;
  maxLength?: number;
}

/**
 * Normalizes and validates a human-facing name, returning the cleaned value. Throws
 * BadRequestError with a specific reason when the name is empty, too short/long,
 * contains a link, or trips the profanity filter. Used for anything other members
 * see — display names and workspace names alike.
 */
export function assertCleanName(
  raw: string,
  options: CleanNameOptions = {},
): string {
  const {
    label = 'Name',
    minLength = MIN_LENGTH,
    maxLength = MAX_LENGTH,
  } = options;
  const name = normalizeDisplayName(raw);
  if (name.length < minLength) {
    throw new BadRequestError(
      `${label} must be at least ${minLength} characters.`,
    );
  }
  if (name.length > maxLength) {
    throw new BadRequestError(
      `${label} must be at most ${maxLength} characters.`,
    );
  }
  if (/https?:\/\/|www\./i.test(name)) {
    throw new BadRequestError(`${label} cannot contain a link.`);
  }
  if (containsProfanity(name)) {
    throw new BadRequestError(`Please choose a different ${label.toLowerCase()}.`);
  }
  return name;
}

/** Cleans a user's display name. Thin wrapper over assertCleanName. */
export function assertCleanDisplayName(raw: string): string {
  return assertCleanName(raw);
}
