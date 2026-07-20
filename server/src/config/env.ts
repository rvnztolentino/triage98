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
