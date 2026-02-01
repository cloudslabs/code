import { useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout.js';
import { SetupScreen } from './components/settings/SetupScreen.js';
import { SettingsModal } from './components/settings/SettingsModal.js';
import { ProjectSettingsPanel } from './components/projects/ProjectSettingsPanel.js';
import { ProjectSetupPanel } from './components/setup/ProjectSetupPanel.js';
import { AgentDetailPanel } from './components/agents/AgentDetailPanel.js';
import { PlansPanel } from './components/plan/PlansPanel.js';
import { MemoryPanel } from './components/memory/MemoryPanel.js';
import { TokenStatsPanel } from './components/context/TokenStatsPanel.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useAppStateBridge } from './hooks/useAppStateBridge.js';
import { useProjectStore } from './stores/project-store.js';
import { useSettingsStore } from './stores/settings-store.js';
import { usePlanPanelStore } from './stores/plan-panel-store.js';
import { api } from './lib/api-client.js';

export function App() {
  useWebSocket();
  useAppStateBridge();

  const setWorkspaceId = useProjectStore((s) => s.setWorkspaceId);
  const setProjects = useProjectStore((s) => s.setProjects);
  const authenticated = useSettingsStore((s) => s.authenticated);
  const setAuthStatus = useSettingsStore((s) => s.setAuthStatus);

  // Check auth status on mount
  useEffect(() => {
    api.getAuthStatus()
      .then((status) => setAuthStatus(status))
      .catch(() => setAuthStatus({ authenticated: false, authType: 'none', subscriptionType: null }));
  }, [setAuthStatus]);

  // Cmd+Shift+P / Ctrl+Shift+P to toggle plan mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        usePlanPanelStore.getState().togglePanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load workspace and projects only when authenticated
  useEffect(() => {
    if (authenticated !== true) return;

    api.getWorkspace()
      .then(({ workspaceId }) => {
        setWorkspaceId(workspaceId);
        return api.listProjects(workspaceId);
      })
      .then(({ projects }) => {
        setProjects(projects);
      })
      .catch((err) => {
        console.error('Failed to load workspace:', err);
      });
  }, [authenticated, setWorkspaceId, setProjects]);

  // Loading state
  if (authenticated === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
      </div>
    );
  }

  // Setup gate
  if (!authenticated) {
    return <SetupScreen />;
  }

  return (
    <>
      <MainLayout />
      <ProjectSetupPanel />
      <ProjectSettingsPanel />
      <AgentDetailPanel />
      <MemoryPanel />
      <TokenStatsPanel />
      <PlansPanel />
      <SettingsModal />
    </>
  );
}
