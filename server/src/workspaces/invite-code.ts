import { randomInt } from 'node:crypto';
import { BadRequestError } from '../lib/errors.js';

// Invite codes are read off a screen and typed by hand, so the alphabet drops the
// characters people confuse (0/O, 1/I/L) and the format is grouped. They are also
// bearer credentials — anyone holding one joins the workspace — so the entropy comes
// from a CSPRNG, never Math.random.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_SIZE = 4;
const GROUP_COUNT = 3;

// 31^12 ≈ 7.9e17 possibilities; guessing one is not a realistic attack even before
// the invite caps and expiry limit how many are live at a time.
const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const MIN_LENGTH = 6;
const MAX_LENGTH = 80;

/** Generates a fresh, human-readable invite code (e.g. `K7Q2-M4XR-9TBF`). */
export function generateInviteCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUP_COUNT; group += 1) {
    let chunk = '';
    for (let index = 0; index < GROUP_SIZE; index += 1) {
      chunk += ALPHABET.charAt(randomInt(ALPHABET.length));
    }
    groups.push(chunk);
  }
  return groups.join('-');
}

/**
 * Normalizes user-supplied invite input to the stored form. Accepts a bare code or a
 * full invite link (`…/join?code=ABC-DEF`), since people paste whichever they were
 * given. Throws BadRequestError when the result isn't a plausible code — a
 * deliberately generic failure that doesn't distinguish "malformed" from "unknown".
 */
export function normalizeInviteCode(raw: string): string {
  const value = raw.trim();
  const fromLink = /[?&]code=([^&#]+)/.exec(value);
  const extracted = fromLink?.[1]
    ? decodeURIComponent(fromLink[1].replace(/\+/g, ' ')).trim()
    : value;
  const code = extracted.toUpperCase();

  if (
    code.length < MIN_LENGTH ||
    code.length > MAX_LENGTH ||
    !CODE_PATTERN.test(code)
  ) {
    throw new BadRequestError('Enter a valid invite code or invite link.');
  }
  return code;
}
