import { Circle, CheckCircle2, XCircle, Loader2, SkipForward } from 'lucide-react';
import type { PlanStep, PlanStepStatus } from '@cloudscode/shared';
import { usePlanPanelStore } from '../../stores/plan-panel-store.js';

const statusIcons: Record<PlanStepStatus, React.ReactNode> = {
  pending: <Circle size={16} className="text-zinc-500" />,
  in_progress: <Loader2 size={16} className="text-blue-400 animate-spin" />,
  completed: <CheckCircle2 size={16} className="text-green-400" />,
  failed: <XCircle size={16} className="text-red-400" />,
  skipped: <SkipForward size={16} className="text-zinc-500" />,
};

const agentBadgeColors: Record<string, string> = {
  'code-analyst': 'bg-purple-900/50 text-purple-300',
  'implementer': 'bg-blue-900/50 text-blue-300',
  'test-runner': 'bg-green-900/50 text-green-300',
  'researcher': 'bg-amber-900/50 text-amber-300',
};

const complexityBadgeColors: Record<string, string> = {
  low: 'bg-zinc-800 text-zinc-400',
  medium: 'bg-amber-900/50 text-amber-300',
  high: 'bg-red-900/50 text-red-300',
};

export function PlanStepsPanel() {
  const currentPlan = usePlanPanelStore((s) => s.currentPlan);

  if (!currentPlan) return null;

  return (
    <div className="border-b border-zinc-700 px-4 py-3 max-h-[40%] overflow-y-auto">
      <div className="mb-2">
        <h3 className="text-sm font-medium text-zinc-200">{currentPlan.title}</h3>
        {currentPlan.summary && (
          <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{currentPlan.summary}</p>
        )}
      </div>

      <div className="space-y-2">
        {currentPlan.steps.map((step, index) => (
          <StepItem key={step.id} step={step} index={index} />
        ))}
      </div>
    </div>
  );
}

function StepItem({ step, index }: { step: PlanStep; index: number }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded bg-zinc-800/50">
      <div className="mt-0.5 shrink-0">{statusIcons[step.status]}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 font-mono">{index + 1}.</span>
          <span className="text-sm text-zinc-200 truncate">{step.title}</span>
        </div>
        {step.description && (
          <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{step.description}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${agentBadgeColors[step.agentType] ?? 'bg-zinc-800 text-zinc-400'}`}>
            {step.agentType}
          </span>
          {step.estimatedComplexity && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${complexityBadgeColors[step.estimatedComplexity]}`}>
              {step.estimatedComplexity}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
