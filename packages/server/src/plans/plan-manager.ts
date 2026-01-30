import type { Plan, PlanStep, PlanListItem } from '@cloudscode/shared';
import { getDb } from '../db/database.js';
import { generateId, nowUnix } from '@cloudscode/shared';
import { logger } from '../logger.js';

class PlanManager {
  createPlan(plan: Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>): Plan {
    const db = getDb();
    const id = generateId();
    const now = nowUnix();
    const fullPlan: Plan = {
      ...plan,
      id,
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(
      `INSERT INTO plans (id, project_id, title, summary, steps, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fullPlan.id,
      fullPlan.projectId,
      fullPlan.title,
      fullPlan.summary,
      JSON.stringify(fullPlan.steps),
      fullPlan.status,
      fullPlan.createdAt,
      fullPlan.updatedAt,
    );

    logger.info({ planId: fullPlan.id, projectId: fullPlan.projectId }, 'Plan created');
    return fullPlan;
  }

  getPlan(id: string): Plan | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToPlan(row);
  }

  listPlans(projectId: string): PlanListItem[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM plans WHERE project_id = ? ORDER BY updated_at DESC'
    ).all(projectId) as any[];

    return rows.map((row) => {
      const steps: PlanStep[] = JSON.parse(row.steps || '[]');
      return {
        id: row.id,
        projectId: row.project_id,
        title: row.title,
        summary: row.summary,
        status: row.status,
        stepCount: steps.length,
        completedStepCount: steps.filter((s) => s.status === 'completed').length,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  updatePlan(id: string, updates: Partial<Pick<Plan, 'title' | 'summary' | 'steps' | 'status'>>): void {
    const db = getDb();
    const sets: string[] = ['updated_at = ?'];
    const values: unknown[] = [nowUnix()];

    if (updates.title !== undefined) {
      sets.push('title = ?');
      values.push(updates.title);
    }
    if (updates.summary !== undefined) {
      sets.push('summary = ?');
      values.push(updates.summary);
    }
    if (updates.steps !== undefined) {
      sets.push('steps = ?');
      values.push(JSON.stringify(updates.steps));
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }

    values.push(id);
    db.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    logger.info({ planId: id }, 'Plan updated');
  }

  updatePlanStep(planId: string, step: PlanStep): void {
    const plan = this.getPlan(planId);
    if (!plan) return;

    const steps = plan.steps.map((s) => (s.id === step.id ? step : s));
    this.updatePlan(planId, { steps });
  }

  deletePlan(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM plans WHERE id = ?').run(id);
    logger.info({ planId: id }, 'Plan deleted');
  }

  private rowToPlan(row: any): Plan {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      summary: row.summary,
      steps: JSON.parse(row.steps || '[]'),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let planManager: PlanManager;

export function initPlanManager(): PlanManager {
  planManager = new PlanManager();
  return planManager;
}

export function getPlanManager(): PlanManager {
  if (!planManager) {
    throw new Error('PlanManager not initialized');
  }
  return planManager;
}
