import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { clientOrigins } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import authRouter from './routes/auth.js';
import healthRouter from './routes/health.js';
import requestsRouter from './routes/requests.js';
import workspacesRouter from './routes/workspaces.js';

/**
 * Builds the Express application. Kept separate from the server bootstrap so it can
 * be constructed in tests without binding a port.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Trust the immediate proxy so req.ip reflects the real client (used as the
  // rate-limit bucket key) when deployed behind one. Loopback-only in practice.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: clientOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  app.get('/', (_req, res) => {
    res.json({ name: 'triage98', status: 'ok' });
  });
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  // Mounted ahead of the workspaces router so /workspaces/:slug/requests resolves
  // here rather than falling through to that router's own /:slug routes.
  app.use('/workspaces/:slug/requests', requestsRouter);
  app.use('/workspaces', workspacesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
