import { Router } from 'express';
import process from 'node:process';
import { pingDatabase } from '../db/pool.js';
import { summarizeHealth } from '../lib/health.js';
import { pingRedis } from '../redis/client.js';

const router = Router();

// GET /health — reports liveness of the API and its dependencies. Returns 200 when
// everything is reachable, 503 when a dependency is down (still a well-formed body).
router.get('/', async (_req, res) => {
  const [databaseUp, redisUp] = await Promise.all([pingDatabase(), pingRedis()]);
  const report = summarizeHealth(databaseUp, redisUp, process.uptime());
  res.status(report.status === 'ok' ? 200 : 503).json(report);
});

export default router;
