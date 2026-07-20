import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

// Password hashing is centralized here so the cost factor and algorithm live in one
// place. bcryptjs is a pure-JS implementation (no native build step), which keeps the
// local-first setup painless across platforms.

/** Hashes a plaintext password with the configured bcrypt cost factor. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, env.BCRYPT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash. Returns false rather
 * than throwing on a malformed hash, so a corrupt row reads as "wrong password"
 * instead of a 500.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * A valid bcrypt hash of a random, unknowable value, computed once at startup. Login
 * compares against this when the email is unknown so the request spends the same time
 * hashing whether or not the account exists — closing the timing side channel that
 * would otherwise reveal which emails are registered.
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomUUID(), env.BCRYPT_ROUNDS);

