import type { ContextBudget, TokenUsageUpdate, AgentTokenUsage } from '@cloudscode/shared';
import { MAX_MEMORY_INJECTION_ENTRIES } from '@cloudscode/shared';
import { getMemoryStore } from './memory-store.js';
import { broadcast } from '../ws.js';
import { logger } from '../logger.js';

class ContextManager {
  private budgets = new Map<string, ContextBudget>();
  private agentUsages = new Map<string, Map<string, AgentTokenUsage>>();

  getBudget(projectId: string): ContextBudget {
    let budget = this.budgets.get(projectId);
    if (!budget) {
      budget = {
        projectId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        maxBudgetUsd: null,
        agentBreakdown: [],
      };
      this.budgets.set(projectId, budget);
    }
    return budget;
  }

  updateBudget(projectId: string, update: TokenUsageUpdate): void {
    const budget = this.getBudget(projectId);
    budget.inputTokens += update.inputTokens;
    budget.outputTokens += update.outputTokens;
    budget.cacheReadTokens += update.cacheReadTokens;
    budget.cacheWriteTokens += update.cacheWriteTokens;
    budget.totalTokens = budget.inputTokens + budget.outputTokens;
    budget.costUsd += update.costUsd;

    // Update agent breakdown
    budget.agentBreakdown = this.getAgentBreakdown(projectId);

    broadcast({ type: 'context:update', payload: budget });
    logger.debug({ projectId, totalTokens: budget.totalTokens, costUsd: budget.costUsd }, 'Budget updated');
  }

  updateAgentUsage(projectId: string, agentId: string, agentType: string, update: TokenUsageUpdate): void {
    if (!this.agentUsages.has(projectId)) {
      this.agentUsages.set(projectId, new Map());
    }
    const projectUsages = this.agentUsages.get(projectId)!;

    const existing = projectUsages.get(agentId) ?? {
      agentId,
      agentType,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    existing.inputTokens += update.inputTokens;
    existing.outputTokens += update.outputTokens;
    existing.costUsd += update.costUsd;

    projectUsages.set(agentId, existing);
  }

  setMaxBudget(projectId: string, maxBudgetUsd: number | null): void {
    const budget = this.getBudget(projectId);
    budget.maxBudgetUsd = maxBudgetUsd;
  }

  isBudgetExhausted(projectId: string): boolean {
    const budget = this.getBudget(projectId);
    if (budget.maxBudgetUsd === null) return false;
    return budget.costUsd >= budget.maxBudgetUsd;
  }

  getMemoryContext(workspaceId: string, currentPrompt: string, projectId?: string): string | null {
    try {
      const memoryStore = getMemoryStore();

      // Search for relevant memories (project-scoped if projectId provided)
      const results = projectId
        ? memoryStore.searchByProject(workspaceId, projectId, currentPrompt, MAX_MEMORY_INJECTION_ENTRIES)
        : memoryStore.search(workspaceId, currentPrompt, MAX_MEMORY_INJECTION_ENTRIES);

      if (results.length === 0) {
        // Fall back to recent entries
        const recent = projectId
          ? memoryStore.listByProject(workspaceId, projectId)
          : memoryStore.listByWorkspace(workspaceId);
        if (recent.length === 0) return null;
        return memoryStore.formatForContext(recent.slice(0, MAX_MEMORY_INJECTION_ENTRIES));
      }

      return memoryStore.formatForContext(results.map((r) => r.entry));
    } catch (err) {
      logger.error({ err }, 'Failed to get memory context');
      return null;
    }
  }

  private getAgentBreakdown(projectId: string): AgentTokenUsage[] {
    const projectUsages = this.agentUsages.get(projectId);
    if (!projectUsages) return [];
    return Array.from(projectUsages.values());
  }

  clearProject(projectId: string): void {
    this.budgets.delete(projectId);
    this.agentUsages.delete(projectId);
  }
}

let contextManager: ContextManager;

export function initContextManager(): ContextManager {
  contextManager = new ContextManager();
  return contextManager;
}

export function getContextManager(): ContextManager {
  if (!contextManager) {
    throw new Error('ContextManager not initialized');
  }
  return contextManager;
}
