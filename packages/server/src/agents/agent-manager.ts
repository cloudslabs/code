import type { AgentNode, AgentType, AgentStatus, AgentTree, AgentContextSection } from '@cloudscode/shared';
import { generateId, nowUnix } from '@cloudscode/shared';
import { broadcast } from '../ws.js';
import { getDb } from '../db/database.js';
import { logger } from '../logger.js';

class AgentManager {
  private agents = new Map<string, AgentNode>();
  private projectAgents = new Map<string, Set<string>>();

  createAgent(
    projectId: string,
    type: AgentType,
    parentAgentId: string | null = null,
    taskDescription: string | null = null,
    model: string | null = null,
    channel?: 'chat' | 'setup' | 'plan',
  ): AgentNode {
    const agent: AgentNode = {
      id: generateId(),
      projectId,
      type,
      status: 'running',
      parentAgentId,
      taskDescription,
      resultSummary: null,
      costUsd: 0,
      tokens: 0,
      durationMs: null,
      startedAt: nowUnix(),
      completedAt: null,
      model,
      responseText: null,
      ...(channel ? { channel } : {}),
    };

    this.agents.set(agent.id, agent);

    if (!this.projectAgents.has(projectId)) {
      this.projectAgents.set(projectId, new Set());
    }
    this.projectAgents.get(projectId)!.add(agent.id);

    // Persist to database
    try {
      getDb().prepare(
        `INSERT INTO agent_runs (id, project_id, agent_type, status, parent_agent_id, task_description, model, cost_usd, tokens, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(agent.id, projectId, type, 'running', parentAgentId, taskDescription, model, 0, 0, agent.startedAt);
    } catch (err) {
      logger.error({ err, agentId: agent.id }, 'Failed to persist agent run');
    }

    logger.info({ agentId: agent.id, type, projectId }, 'Agent created');
    broadcast({ type: 'agent:started', payload: agent });

    return agent;
  }

  updateAgentStatus(agentId: string, status: AgentStatus, resultSummary?: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      logger.warn({ agentId }, 'Agent not found for status update');
      return;
    }

    agent.status = status;
    if (resultSummary !== undefined) {
      agent.resultSummary = resultSummary;
    }
    if (status === 'completed' || status === 'failed' || status === 'interrupted') {
      agent.completedAt = nowUnix();
      if (agent.startedAt) {
        agent.durationMs = (agent.completedAt - agent.startedAt) * 1000;
      }
    }

    // Persist to database
    try {
      getDb().prepare(
        `UPDATE agent_runs SET status = ?, result_summary = ?, duration_ms = ?, completed_at = ? WHERE id = ?`
      ).run(agent.status, agent.resultSummary, agent.durationMs, agent.completedAt, agentId);
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to persist agent status update');
    }

    logger.info({ agentId, status }, 'Agent status updated');
    broadcast({ type: 'agent:stopped', payload: agent });
  }

  updateAgentCost(agentId: string, costUsd: number, tokens: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.costUsd += costUsd;
    agent.tokens += tokens;

    // Persist to database
    try {
      getDb().prepare(
        `UPDATE agent_runs SET cost_usd = ?, tokens = ? WHERE id = ?`
      ).run(agent.costUsd, agent.tokens, agentId);
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to persist agent cost update');
    }
  }

  setAgentResponse(agentId: string, responseText: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.responseText = responseText;
    }

    // Persist to database
    try {
      getDb().prepare(
        `UPDATE agent_runs SET response_text = ? WHERE id = ?`
      ).run(responseText, agentId);
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to persist agent response text');
    }
  }

  getAgent(agentId: string): AgentNode | undefined {
    return this.agents.get(agentId);
  }

  getAgentTree(projectId: string): AgentTree | null {
    const agentIds = this.projectAgents.get(projectId);
    if (!agentIds) return null;

    const agents = Array.from(agentIds)
      .map((id) => this.agents.get(id))
      .filter((a): a is AgentNode => a !== undefined);

    const orchestrator = agents.find((a) => a.type === 'orchestrator');
    if (!orchestrator) return null;

    return {
      orchestrator,
      subagents: agents.filter((a) => a.type !== 'orchestrator'),
    };
  }

  getRunningAgents(projectId: string): AgentNode[] {
    const agentIds = this.projectAgents.get(projectId);
    if (!agentIds) return [];
    return Array.from(agentIds)
      .map((id) => this.agents.get(id))
      .filter((a): a is AgentNode => a !== undefined && a.status === 'running');
  }

  clearProject(projectId: string): void {
    const agentIds = this.projectAgents.get(projectId);
    if (agentIds) {
      for (const id of agentIds) {
        this.agents.delete(id);
      }
      this.projectAgents.delete(projectId);
    }
  }

  getAgentHistory(projectId: string): AgentNode[] {
    try {
      const rows = getDb().prepare(
        `SELECT id, project_id, agent_type, status, parent_agent_id, task_description, result_summary, cost_usd, tokens, duration_ms, started_at, completed_at, model, response_text
         FROM agent_runs WHERE project_id = ? ORDER BY started_at ASC`
      ).all(projectId) as any[];

      return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        type: r.agent_type as AgentType,
        status: r.status as AgentStatus,
        parentAgentId: r.parent_agent_id ?? null,
        taskDescription: r.task_description ?? null,
        resultSummary: r.result_summary ?? null,
        costUsd: r.cost_usd ?? 0,
        tokens: r.tokens ?? 0,
        durationMs: r.duration_ms ?? null,
        startedAt: r.started_at,
        completedAt: r.completed_at ?? null,
        model: r.model ?? null,
        responseText: r.response_text ?? null,
      }));
    } catch (err) {
      logger.error({ err, projectId }, 'Failed to load agent history');
      return [];
    }
  }

  setAgentContextSections(agentId: string, sections: AgentContextSection[]): void {
    try {
      getDb().prepare(
        `UPDATE agent_runs SET context_sections = ? WHERE id = ?`
      ).run(JSON.stringify(sections), agentId);
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to persist agent context sections');
    }
  }

  getAgentHistoryWithContexts(projectId: string): { agents: AgentNode[]; contextSections: Record<string, AgentContextSection[]> } {
    try {
      const rows = getDb().prepare(
        `SELECT id, project_id, agent_type, status, parent_agent_id, task_description, result_summary, cost_usd, tokens, duration_ms, started_at, completed_at, model, response_text, context_sections
         FROM agent_runs WHERE project_id = ? ORDER BY started_at ASC`
      ).all(projectId) as any[];

      const agents: AgentNode[] = [];
      const contextSections: Record<string, AgentContextSection[]> = {};

      for (const r of rows) {
        agents.push({
          id: r.id,
          projectId: r.project_id,
          type: r.agent_type as AgentType,
          status: r.status as AgentStatus,
          parentAgentId: r.parent_agent_id ?? null,
          taskDescription: r.task_description ?? null,
          resultSummary: r.result_summary ?? null,
          costUsd: r.cost_usd ?? 0,
          tokens: r.tokens ?? 0,
          durationMs: r.duration_ms ?? null,
          startedAt: r.started_at,
          completedAt: r.completed_at ?? null,
          model: r.model ?? null,
          responseText: r.response_text ?? null,
        });

        if (r.context_sections) {
          try {
            contextSections[r.id] = JSON.parse(r.context_sections);
          } catch {
            // ignore malformed JSON
          }
        }
      }

      return { agents, contextSections };
    } catch (err) {
      logger.error({ err, projectId }, 'Failed to load agent history with contexts');
      return { agents: [], contextSections: {} };
    }
  }
}

let agentManager: AgentManager;

export function getAgentManager(): AgentManager {
  if (!agentManager) {
    agentManager = new AgentManager();
  }
  return agentManager;
}
