import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api.js';
import { projectsRouter } from './routes/projects.js';
import { memoryRouter } from './routes/memory.js';
import { settingsRouter } from './routes/settings.js';
import { plansRouter } from './routes/plans.js';
import { logger } from './logger.js';

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use((req, _res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'Request');
    next();
  });

  app.use('/api', apiRouter());
  app.use('/api/projects', projectsRouter());
  app.use('/api/memory', memoryRouter());
  app.use('/api/settings', settingsRouter());
  app.use('/api/plans', plansRouter());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
