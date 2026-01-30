import { useSettingsStore } from '../../stores/settings-store.js';
import { AgentSummary } from '../agents/AgentSummary.js';
import { ContextDashboard } from '../context/ContextDashboard.js';
import { KnowledgeBase } from '../memory/KnowledgeBase.js';
import { PlanListTab } from '../plan/PlanListTab.js';

const tabs = [
  { id: 'agents' as const, label: 'Agents' },
  { id: 'plans' as const, label: 'Plans' },
  { id: 'context' as const, label: 'Context' },
  { id: 'memory' as const, label: 'Memory' },
];

export function RightPanel() {
  const activeTab = useSettingsStore((s) => s.rightPanelTab);
  const setTab = useSettingsStore((s) => s.setRightPanelTab);

  return (
    <aside className="w-80 border-l border-zinc-800 flex flex-col bg-zinc-925">
      <div className="flex border-b border-zinc-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={`flex-1 px-3 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'text-zinc-100 border-b-2 border-blue-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'agents' && <AgentSummary />}
        {activeTab === 'plans' && <PlanListTab />}
        {activeTab === 'context' && <ContextDashboard />}
        {activeTab === 'memory' && <KnowledgeBase />}
      </div>
    </aside>
  );
}
