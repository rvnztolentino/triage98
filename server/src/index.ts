import process from 'node:process';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { redis } from './redis/client.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Triage98 API listening on http://localhost:${env.PORT}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  server.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
