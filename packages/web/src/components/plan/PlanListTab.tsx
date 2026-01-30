import { useEffect } from 'react';
import { Play, FileText, Trash2, Map } from 'lucide-react';
import type { PlanListItem, PlanStatus } from '@cloudscode/shared';
import { usePlanListStore } from '../../stores/plan-list-store.js';
import { usePlanPanelStore } from '../../stores/plan-panel-store.js';
import { useProjectStore } from '../../stores/project-store.js';
import { wsClient } from '../../lib/ws-client.js';
import { api } from '../../lib/api-client.js';

const statusColors: Record<PlanStatus, string> = {
  drafting: 'bg-amber-900/50 text-amber-300',
  ready: 'bg-blue-900/50 text-blue-300',
  executing: 'bg-purple-900/50 text-purple-300',
  completed: 'bg-green-900/50 text-green-300',
  failed: 'bg-red-900/50 text-red-300',
  cancelled: 'bg-zinc-800 text-zinc-400',
};

function relativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function PlanListTab() {
  const plans = usePlanListStore((s) => s.plans);
  const loading = usePlanListStore((s) => s.loading);
  const loadPlans = usePlanListStore((s) => s.loadPlans);
  const activeProject = useProjectStore((s) => s.activeProject);

  useEffect(() => {
    if (activeProject?.id) {
      loadPlans(activeProject.id);
    }
  }, [activeProject?.id, loadPlans]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <Map size={32} className="text-zinc-600 mb-3" />
        <p className="text-sm text-zinc-400">No plans yet.</p>
        <p className="text-xs text-zinc-500 mt-1">
          Open Plan Mode to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanListItem }) {
  const handleExecute = () => {
    wsClient.send({
      type: 'plan:execute',
      payload: { planId: plan.id },
    });
  };

  const handleOpen = async () => {
    try {
      const fullPlan = await api.getPlan(plan.id);
      usePlanPanelStore.getState().setPlan(fullPlan);
      usePlanPanelStore.getState().openPanel();
    } catch (err) {
      console.error('Failed to load plan:', err);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deletePlan(plan.id);
      usePlanListStore.getState().removePlan(plan.id);
    } catch (err) {
      console.error('Failed to delete plan:', err);
    }
  };

  const canExecute = plan.status === 'ready' || plan.status === 'completed' || plan.status === 'failed';

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm text-zinc-200 font-medium truncate">{plan.title}</h4>
          {plan.summary && (
            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{plan.summary}</p>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${statusColors[plan.status]}`}>
          {plan.status}
        </span>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{plan.completedStepCount}/{plan.stepCount} steps</span>
          <span>{relativeTime(plan.updatedAt)}</span>
        </div>

        <div className="flex items-center gap-1">
          {canExecute && (
            <button
              onClick={handleExecute}
              className="p-1 rounded text-zinc-400 hover:text-green-400 hover:bg-zinc-700 transition-colors"
              title="Execute"
            >
              <Play size={14} />
            </button>
          )}
          <button
            onClick={handleOpen}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
            title="Open"
          >
            <FileText size={14} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
