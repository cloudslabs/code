import { X, Play, Save, Ban } from 'lucide-react';
import { usePlanPanelStore } from '../../stores/plan-panel-store.js';
import { wsClient } from '../../lib/ws-client.js';

interface PlanPanelHeaderProps {
  onClose: () => void;
}

export function PlanPanelHeader({ onClose }: PlanPanelHeaderProps) {
  const currentPlan = usePlanPanelStore((s) => s.currentPlan);
  const isExecuting = usePlanPanelStore((s) => s.isExecuting);

  const handleApproveExecute = () => {
    if (!currentPlan) return;
    wsClient.send({
      type: 'plan:approve',
      payload: { planId: currentPlan.id },
    });
  };

  const handleSaveClose = () => {
    wsClient.send({ type: 'plan:save' });
    usePlanPanelStore.getState().closePanel();
  };

  const handleCancel = () => {
    wsClient.send({ type: 'plan:cancel' });
    usePlanPanelStore.getState().closePanel();
  };

  const showApprove = currentPlan && currentPlan.status === 'ready' && !isExecuting;
  const showSave = currentPlan && !isExecuting;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
      <div>
        <h2 className="text-sm font-medium text-zinc-100">Plan Mode</h2>
        <p className="text-xs text-zinc-500">
          {isExecuting ? 'Executing plan...' : 'Collaborate to create an execution plan'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {showApprove && (
          <button
            onClick={handleApproveExecute}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-green-600 hover:bg-green-500 text-white transition-colors"
          >
            <Play size={12} />
            Approve & Execute
          </button>
        )}

        {showSave && (
          <button
            onClick={handleSaveClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
          >
            <Save size={12} />
            Save & Close
          </button>
        )}

        <button
          onClick={handleCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Cancel"
        >
          <Ban size={12} />
        </button>

        <button
          onClick={onClose}
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
