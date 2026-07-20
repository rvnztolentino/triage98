import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { z } from 'zod';

// The server runs from the server/ workspace directory, so the repo-root .env is
// one level up. Load it first, then any server-local .env as an override. Both are
// optional — every variable below has a working local default.
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Comma-separated list of allowed browser origins.
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://triage98:triage98@localhost:5432/triage98'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  // Secret used to sign JWT session tokens. The default is fine for local dev; any
  // real deployment MUST override it (see .env.example). Enforced non-empty so a
  // blank value can never silently produce forgeable tokens.
  JWT_SECRET: z.string().min(1).default('dev-insecure-jwt-secret-change-me'),
  // Session lifetime, as a value the `jose` library understands (e.g. '7d', '12h').
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  // bcrypt cost factor. 10 is a sensible default for a laptop; higher is slower.
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  // First user to register (or whose email matches this) becomes the seed owner.
  // Blank disables the behavior. Mirrors the reference's SEED_ADMIN_EMAIL.
  SEED_ADMIN_EMAIL: z.string().default(''),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable message rather than crashing deep in a handler.
  console.error('Invalid environment configuration:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof EnvSchema>;

/** Allowed CORS origins, parsed from the comma-separated CLIENT_ORIGIN. */
export const clientOrigins = env.CLIENT_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
