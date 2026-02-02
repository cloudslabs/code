import { Router } from 'express';
import type { ProjectMetadataCategory } from '@cloudscode/shared';
import { getAuthStatus, clearOAuthCredentials } from '../auth/api-key-provider.js';
import { startOAuthFlow, isFlowActive } from '../auth/oauth-flow.js';
import { getProjectSettingsService } from '../services/project-settings.js';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';
import { getProjectsRootDir, setProjectsRootDir } from '../projects/directory-manager.js';

export function settingsRouter(): Router {
  const router = Router();

  // GET /api/settings/auth/status
  router.get('/auth/status', (_req, res) => {
    const status = getAuthStatus();
    res.json(status);
  });

  // POST /api/settings/auth/login — starts server-side OAuth PKCE flow
  router.post('/auth/login', async (_req, res) => {
    const status = getAuthStatus();
    if (status.authenticated) {
      res.json({ started: false, reason: 'Already authenticated' });
      return;
    }
    if (isFlowActive()) {
      res.json({ started: false, reason: 'Login already in progress' });
      return;
    }
    try {
      await startOAuthFlow();
      res.json({ started: true });
    } catch (err) {
      logger.error({ err }, 'Failed to start OAuth flow');
      res.status(500).json({ error: 'Failed to start login process' });
    }
  });

  // POST /api/settings/auth/logout — clears stored OAuth credentials
  router.post('/auth/logout', (_req, res) => {
    const cleared = clearOAuthCredentials();
    const status = getAuthStatus();
    res.json({ cleared, ...status });
  });

  // GET /api/settings/projects-root — get the configured projects root directory
  router.get('/projects-root', (_req, res) => {
    const projectsRootDir = getProjectsRootDir();
    res.json({ projectsRootDir });
  });

  // PUT /api/settings/projects-root — set the projects root directory
  router.put('/projects-root', (req, res) => {
    try {
      const { rootDir } = req.body;
      if (!rootDir || typeof rootDir !== 'string') {
        res.status(400).json({ error: 'rootDir is required' });
        return;
      }
      setProjectsRootDir(rootDir);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Failed to set projects root dir');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to set root directory' });
    }
  });

  return router;
}
