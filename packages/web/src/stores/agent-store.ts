import { create } from 'zustand';
import type { AgentNode, AgentToolActivity, AgentContextSection, ToolCall } from '@cloudscode/shared';

interface AgentState {
  agents: Map<string, AgentNode>;
  toolActivity: AgentToolActivity[];
  toolCalls: Map<string, AgentToolActivity>;
  agentContexts: Map<string, AgentContextSection[]>;
  selectedToolCallId: string | null;
  selectedAgentId: string | null;

  addAgent: (agent: AgentNode) => void;
  updateAgent: (agent: AgentNode) => void;
  addToolActivity: (activity: AgentToolActivity) => void;
  updateToolResult: (toolCallId: string, output: unknown, status: 'completed' | 'failed', durationMs: number) => void;
  loadAgentHistory: (agents: AgentNode[], toolCalls: ToolCall[], contextSections?: Record<string, AgentContextSection[]>) => void;
  setAgentContext: (agentId: string, sections: AgentContextSection[]) => void;
  selectToolCall: (toolCallId: string | null) => void;
  selectAgent: (agentId: string | null) => void;
  clearAgents: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: new Map(),
  toolActivity: [],
  toolCalls: new Map(),
  agentContexts: new Map(),
  selectedToolCallId: null,
  selectedAgentId: null,

  addAgent: (agent) =>
    set((state) => {
      const agents = new Map(state.agents);
      agents.set(agent.id, agent);
      return { agents };
    }),

  updateAgent: (agent) =>
    set((state) => {
      const agents = new Map(state.agents);
      agents.set(agent.id, agent);
      return { agents };
    }),

  addToolActivity: (activity) =>
    set((state) => {
      const toolCalls = new Map(state.toolCalls);
      toolCalls.set(activity.id, activity);
      return {
        toolActivity: [...state.toolActivity.slice(-50), activity],
        toolCalls,
      };
    }),

  updateToolResult: (toolCallId, output, status, durationMs) =>
    set((state) => {
      const toolCalls = new Map(state.toolCalls);
      const existing = toolCalls.get(toolCallId);
      if (existing) {
        toolCalls.set(toolCallId, { ...existing, output, status, durationMs });
      }
      const toolActivity = state.toolActivity.map((a) =>
        a.id === toolCallId ? { ...a, output, status, durationMs } : a,
      );
      return { toolCalls, toolActivity };
    }),

  loadAgentHistory: (agents, toolCalls, contextSections) =>
    set(() => {
      const agentMap = new Map<string, AgentNode>();
      for (const a of agents) {
        agentMap.set(a.id, a);
      }

      const activityList: AgentToolActivity[] = [];
      const callMap = new Map<string, AgentToolActivity>();
      for (const tc of toolCalls) {
        let parsedInput: Record<string, unknown> = {};
        try { parsedInput = JSON.parse(tc.input); } catch { /* ignore */ }
        let parsedOutput: unknown = undefined;
        if (tc.output) {
          try { parsedOutput = JSON.parse(tc.output); } catch { parsedOutput = tc.output; }
        }
        const activity: AgentToolActivity = {
          id: tc.id,
          agentId: tc.agentId,
          toolName: tc.toolName,
          input: parsedInput,
          output: parsedOutput,
          status: tc.status as 'running' | 'completed' | 'failed',
          durationMs: tc.durationMs ?? undefined,
          timestamp: tc.startedAt * 1000,
        };
        activityList.push(activity);
        callMap.set(tc.id, activity);
      }

      const agentContexts = new Map<string, AgentContextSection[]>();
      if (contextSections) {
        for (const [agentId, sections] of Object.entries(contextSections)) {
          agentContexts.set(agentId, sections);
        }
      }

      return {
        agents: agentMap,
        toolActivity: activityList,
        toolCalls: callMap,
        agentContexts,
      };
    }),

  setAgentContext: (agentId, sections) =>
    set((state) => {
      const agentContexts = new Map(state.agentContexts);
      agentContexts.set(agentId, sections);
      return { agentContexts };
    }),

  selectToolCall: (toolCallId) => set({ selectedToolCallId: toolCallId }),

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  clearAgents: () => set({ agents: new Map(), toolActivity: [], toolCalls: new Map(), agentContexts: new Map(), selectedToolCallId: null, selectedAgentId: null }),
}));
