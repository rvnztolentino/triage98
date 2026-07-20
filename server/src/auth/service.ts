import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { ConflictError } from '../lib/errors.js';
import type { AppUser, UserRole } from './types.js';

// Persistence for the identity model. Every field the app returns comes from our own
// `users` table keyed by an app-owned UUID — the id is never tied to an external auth
// provider (the coupling the reference had to migrate away from).

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  password_hash: string;
}

function normalizeRole(role: string): UserRole {
  return role === 'owner' || role === 'admin' ? role : 'requester';
}

function rowToUser(row: UserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email.split('@')[0] || row.email,
    role: normalizeRole(row.role),
  };
}

/**
 * Global default role for a newly registered email. The configured SEED_ADMIN_EMAIL
 * becomes an owner so a fresh install has an administrator; everyone else starts as a
 * requester. Workspace-level permissions still come from workspace_members.role.
 */
export function roleForEmail(email: string): UserRole {
  const seed = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  return seed && email.trim().toLowerCase() === seed ? 'owner' : 'requester';
}

const UNIQUE_VIOLATION = '23505';

/**
 * Creates a user with the given (already-hashed) password. Throws ConflictError if
 * the email is already registered, relying on the unique index rather than a
 * check-then-insert race.
 */
export async function createUser(input: {
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
}): Promise<AppUser> {
  try {
    const { rows } = await pool.query<UserRow>(
      `insert into users (email, password_hash, display_name, role)
       values ($1, $2, $3, $4)
       returning id, email, display_name, role, password_hash`,
      [input.email, input.passwordHash, input.displayName, input.role],
    );
    // insert ... returning always yields exactly one row on success.
    return rowToUser(rows[0] as UserRow);
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictError('An account with this email already exists.');
    }
    throw err;
  }
}

/** Looks up a user by id. Returns null when no such user exists. */
export async function getUserById(id: string): Promise<AppUser | null> {
  const { rows } = await pool.query<UserRow>(
    `select id, email, display_name, role, password_hash
       from users
      where id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? rowToUser(row) : null;
}

/**
 * Looks up a user by email for authentication, returning the stored password hash
 * alongside the safe user shape. Returns null when no such user exists. The email is
 * expected to be already normalized (lowercased/trimmed) by the request schema.
 */
export async function getUserAuthByEmail(
  email: string,
): Promise<{ user: AppUser; passwordHash: string } | null> {
  const { rows } = await pool.query<UserRow>(
    `select id, email, display_name, role, password_hash
       from users
      where email = $1`,
    [email],
  );
  const row = rows[0];
  return row ? { user: rowToUser(row), passwordHash: row.password_hash } : null;
}
