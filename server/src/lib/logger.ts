import pino from 'pino';
import { env } from '../config/env.js';

// Pretty transport in development is intentionally omitted to keep the dependency
// surface small; structured JSON logs are the right default for a self-hosted app.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'triage98-server' },
});
