import { create } from 'zustand';
import type { ContextBudget } from '@cloudscode/shared';

type AuthType = 'oauth' | 'api_key' | 'none';

interface SettingsState {
  rightPanelOpen: boolean;
  rightPanelTab: 'agents' | 'plans' | 'context' | 'memory';
  contextBudget: ContextBudget | null;

  // Project settings panel
  projectSettingsOpen: boolean;

  // Agent detail panel
  agentDetailPanelOpen: boolean;

  // Auth state
  authenticated: boolean | null; // null = loading
  authType: AuthType;
  subscriptionType: string | null;
  settingsModalOpen: boolean;

  toggleRightPanel: () => void;
  setRightPanelTab: (tab: 'agents' | 'plans' | 'context' | 'memory') => void;
  setContextBudget: (budget: ContextBudget) => void;

  openProjectSettings: () => void;
  closeProjectSettings: () => void;

  openAgentDetailPanel: () => void;
  closeAgentDetailPanel: () => void;

  setAuthStatus: (status: {
    authenticated: boolean;
    authType: AuthType;
    subscriptionType: string | null;
  }) => void;
  openSettingsModal: () => void;
  closeSettingsModal: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  rightPanelOpen: true,
  rightPanelTab: 'agents',
  contextBudget: null,

  projectSettingsOpen: false,
  agentDetailPanelOpen: false,

  authenticated: null,
  authType: 'none',
  subscriptionType: null,
  settingsModalOpen: false,

  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setContextBudget: (budget) => set({ contextBudget: budget }),

  openProjectSettings: () => set({ projectSettingsOpen: true }),
  closeProjectSettings: () => set({ projectSettingsOpen: false }),

  openAgentDetailPanel: () => set({ agentDetailPanelOpen: true }),
  closeAgentDetailPanel: () => set({ agentDetailPanelOpen: false }),

  setAuthStatus: ({ authenticated, authType, subscriptionType }) =>
    set({ authenticated, authType, subscriptionType }),
  openSettingsModal: () => set({ settingsModalOpen: true }),
  closeSettingsModal: () => set({ settingsModalOpen: false }),
}));
