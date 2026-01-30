import { Router } from 'express';
import { getPlanManager } from '../plans/plan-manager.js';

export function plansRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId query parameter required' });
    }
    const planManager = getPlanManager();
    const plans = planManager.listPlans(projectId);
    res.json({ plans });
  });

  router.get('/:id', (req, res) => {
    const planManager = getPlanManager();
    const plan = planManager.getPlan(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    res.json(plan);
  });

  router.delete('/:id', (req, res) => {
    const planManager = getPlanManager();
    planManager.deletePlan(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
