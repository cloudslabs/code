import { Router } from 'express';
import type { UsageGranularity } from '@cloudscode/shared';
import { getTokenUsageStore } from '../db/token-usage-store.js';

export function tokenUsageRouter(): Router {
  const router = Router();

  router.get('/:projectId/history', (req, res) => {
    const { projectId } = req.params;
    const granularity = (req.query.granularity as UsageGranularity) || 'daily';
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;

    const validGranularities: UsageGranularity[] = ['daily', 'weekly', 'monthly'];
    if (!validGranularities.includes(granularity)) {
      return res.status(400).json({ error: 'Invalid granularity. Must be daily, weekly, or monthly.' });
    }

    const store = getTokenUsageStore();
    const history = store.getHistory(projectId, granularity, from, to);
    res.json(history);
  });

  router.get('/:projectId/summary', (req, res) => {
    const { projectId } = req.params;
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;

    const store = getTokenUsageStore();
    const totals = store.getTotals(projectId, from, to);
    res.json({ projectId, totals });
  });

  return router;
}
