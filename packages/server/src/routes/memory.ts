import { Router } from 'express';
import type { MemoryCategory } from '@cloudscode/shared';
import { getMemoryStore } from '../context/memory-store.js';
import { broadcast } from '../ws.js';

export function memoryRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const workspaceId = (req.query.workspaceId ?? req.query.projectId) as string;
    const category = req.query.category as MemoryCategory | undefined;
    const scopeProjectId = req.query.scopeProjectId as string | undefined;
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId required' });
    }
    const store = getMemoryStore();
    const entries = scopeProjectId
      ? store.listByProject(workspaceId, scopeProjectId, category)
      : store.listByWorkspace(workspaceId, category);
    res.json({ entries });
  });

  router.get('/search', (req, res) => {
    const workspaceId = (req.query.workspaceId ?? req.query.projectId) as string;
    const q = req.query.q as string;
    const scopeProjectId = req.query.scopeProjectId as string | undefined;
    if (!workspaceId || !q) {
      return res.status(400).json({ error: 'workspaceId and q required' });
    }
    const store = getMemoryStore();
    const results = scopeProjectId
      ? store.searchByProject(workspaceId, scopeProjectId, q)
      : store.search(workspaceId, q);
    res.json({ results });
  });

  router.get('/:id', (req, res) => {
    const store = getMemoryStore();
    const entry = store.get(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }
    res.json(entry);
  });

  router.post('/', (req, res) => {
    const workspaceId = req.body.workspaceId ?? req.body.projectId;
    const { category, key, content, scope } = req.body;
    if (!workspaceId || !category || !key || !content) {
      return res.status(400).json({ error: 'workspaceId, category, key, and content required' });
    }
    const store = getMemoryStore();
    const entry = store.create(workspaceId, { category, key, content, scope });
    broadcast({ type: 'memory:updated', payload: { entry, action: 'created' } });
    res.status(201).json(entry);
  });

  router.patch('/:id', (req, res) => {
    const store = getMemoryStore();
    const entry = store.update(req.params.id, req.body);
    if (!entry) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }
    broadcast({ type: 'memory:updated', payload: { entry, action: 'updated' } });
    res.json(entry);
  });

  router.delete('/:id', (req, res) => {
    const store = getMemoryStore();
    const entry = store.get(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }
    store.delete(req.params.id);
    broadcast({ type: 'memory:updated', payload: { entry, action: 'deleted' } });
    res.json({ ok: true });
  });

  return router;
}
