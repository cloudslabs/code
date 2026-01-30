import { create } from 'zustand';
import type { Plan, PlanStep, AgentNode, AgentToolActivity } from '@cloudscode/shared';
import type { ChatMessage } from './chat-store.js';

interface PlanPanelState {
  isOpen: boolean;
  currentPlan: Plan | null;
  isExecuting: boolean;

  // Embedded chat state
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  error: string | null;

  // Plan agent tracking
  planAgents: Map<string, AgentNode>;
  planToolActivity: AgentToolActivity[];

  // Actions — panel lifecycle
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  reset: () => void;

  // Actions — plan
  setPlan: (plan: Plan) => void;
  updatePlanStep: (planId: string, step: PlanStep) => void;
  setExecuting: (executing: boolean) => void;
  clearPlan: () => void;

  // Actions — chat
  addMessage: (message: ChatMessage) => void;
  appendToken: (token: string) => void;
  startStreaming: () => void;
  finishStreaming: () => void;
  setError: (error: string | null) => void;
  loadMessages: (messages: ChatMessage[]) => void;
  clearTransient: () => void;

  // Actions — plan agents
  addPlanAgent: (agent: AgentNode) => void;
  updatePlanAgent: (agent: AgentNode) => void;
  addPlanToolActivity: (activity: AgentToolActivity) => void;
  updatePlanToolResult: (toolCallId: string, output: unknown, status: 'completed' | 'failed', durationMs: number) => void;
  clearPlanAgents: () => void;
}

let planMessageCounter = 0;

export const usePlanPanelStore = create<PlanPanelState>((set) => ({
  isOpen: false,
  currentPlan: null,
  isExecuting: false,
  messages: [],
  streamingContent: '',
  isStreaming: false,
  error: null,
  planAgents: new Map(),
  planToolActivity: [],

  openPanel: () => set({ isOpen: true }),
  closePanel: () => set({ isOpen: false }),
  togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

  reset: () =>
    set({
      isOpen: false,
      currentPlan: null,
      isExecuting: false,
      messages: [],
      streamingContent: '',
      isStreaming: false,
      error: null,
      planAgents: new Map(),
      planToolActivity: [],
    }),

  setPlan: (plan) => set({ currentPlan: plan }),

  updatePlanStep: (planId, step) =>
    set((state) => {
      if (!state.currentPlan || state.currentPlan.id !== planId) return {};
      const steps = state.currentPlan.steps.map((s) => (s.id === step.id ? step : s));
      return { currentPlan: { ...state.currentPlan, steps } };
    }),

  setExecuting: (executing) => set({ isExecuting: executing }),

  clearPlan: () => set({ currentPlan: null }),

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  appendToken: (token) =>
    set((state) => ({
      streamingContent: state.streamingContent + token,
    })),

  startStreaming: () =>
    set({ isStreaming: true, streamingContent: '', error: null }),

  finishStreaming: () =>
    set((state) => {
      if (state.streamingContent) {
        return {
          isStreaming: false,
          streamingContent: '',
          messages: [
            ...state.messages,
            {
              id: `plan-stream-${++planMessageCounter}`,
              role: 'assistant' as const,
              content: state.streamingContent,
              agentId: 'orchestrator',
              timestamp: Date.now(),
            },
          ],
        };
      }
      return { isStreaming: false, streamingContent: '' };
    }),

  setError: (error) => set({ error, isStreaming: false }),

  loadMessages: (messages) => set({ messages }),

  clearTransient: () =>
    set({
      streamingContent: '',
      isStreaming: false,
      error: null,
    }),

  addPlanAgent: (agent) =>
    set((state) => {
      const planAgents = new Map(state.planAgents);
      planAgents.set(agent.id, agent);
      return { planAgents };
    }),

  updatePlanAgent: (agent) =>
    set((state) => {
      const planAgents = new Map(state.planAgents);
      planAgents.set(agent.id, agent);
      return { planAgents };
    }),

  addPlanToolActivity: (activity) =>
    set((state) => ({
      planToolActivity: [...state.planToolActivity.slice(-50), activity],
    })),

  updatePlanToolResult: (toolCallId, output, status, durationMs) =>
    set((state) => ({
      planToolActivity: state.planToolActivity.map((a) =>
        a.id === toolCallId ? { ...a, output, status, durationMs } : a,
      ),
    })),

  clearPlanAgents: () => set({ planAgents: new Map(), planToolActivity: [] }),
}));
