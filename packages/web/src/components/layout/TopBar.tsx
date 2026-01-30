import { PanelRightOpen, PanelRightClose, Settings, Activity, Map } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { usePlanPanelStore } from '../../stores/plan-panel-store.js';

export function TopBar() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const rightPanelOpen = useSettingsStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useSettingsStore((s) => s.toggleRightPanel);
  const openProjectSettings = useSettingsStore((s) => s.openProjectSettings);
  const openAgentDetailPanel = useSettingsStore((s) => s.openAgentDetailPanel);
  const contextBudget = useSettingsStore((s) => s.contextBudget);
  const planPanelOpen = usePlanPanelStore((s) => s.isOpen);
  const togglePlanPanel = usePlanPanelStore((s) => s.togglePanel);

  return (
    <header className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-925">
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-300">
          {activeProject?.title ?? (activeProject ? `Project ${activeProject.id.slice(0, 8)}` : 'No active project')}
        </span>
        {activeProject && (
          <span className="text-xs text-zinc-500">
            {activeProject.status}
          </span>
        )}
        {activeProject && (
          <button
            onClick={openProjectSettings}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Project Settings"
          >
            <Settings size={16} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        {contextBudget && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{contextBudget.totalTokens.toLocaleString()} tokens</span>
            <span className="text-zinc-600">|</span>
            <span>${contextBudget.costUsd.toFixed(4)}</span>
          </div>
        )}

        <button
          onClick={togglePlanPanel}
          className={`p-1.5 rounded transition-colors ${
            planPanelOpen
              ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
              : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
          title="Plan Mode (Cmd+Shift+P)"
        >
          <Map size={18} />
        </button>

        <button
          onClick={openAgentDetailPanel}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Agent Activity"
        >
          <Activity size={18} />
        </button>

        <button
          onClick={toggleRightPanel}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      </div>
    </header>
  );
}
