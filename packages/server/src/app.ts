import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { apiRouter } from './routes/api.js';
import { projectsRouter } from './routes/projects.js';
import { memoryRouter } from './routes/memory.js';
import { settingsRouter } from './routes/settings.js';
import { plansRouter } from './routes/plans.js';
import { workflowsRouter } from './routes/workflows.js';
import { promotionRouter } from './routes/promotion.js';
import { tokenUsageRouter } from './routes/token-usage.js';
import { logger } from './logger.js';

export function createApp(staticDir?: string): express.Application {
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
  app.use('/api/workflows', workflowsRouter());
  app.use('/api/promotion', promotionRouter());
  app.use('/api/token-usage', tokenUsageRouter());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Serve static files and SPA fallback when staticDir is provided (production Electron)
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}
