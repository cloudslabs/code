import { Circle, CheckCircle2, XCircle, Loader2, SkipForward, Shield, ShieldCheck, ShieldX } from 'lucide-react';
import type { PlanStep, PlanStepStatus } from '@cloudscode/shared';
import { usePlanPanelStore } from '../../stores/plan-panel-store.js';
import { useWorkflowStore } from '../../stores/workflow-store.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';

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
    <div className="px-4 py-3 flex-1 overflow-y-auto h-full">
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
  const qualityGateResults = useWorkflowStore((s) => s.qualityGateResults);
  const gateResult = qualityGateResults[step.id];
  const stepAgentMap = usePlanPanelStore((s) => s.stepAgentMap);
  const planAgents = usePlanPanelStore((s) => s.planAgents);
  const planToolActivity = usePlanPanelStore((s) => s.planToolActivity);

  const agentId = stepAgentMap[step.id];
  const agent = agentId ? planAgents.get(agentId) : undefined;
  const agentTools = agentId ? planToolActivity.filter((t) => t.agentId === agentId) : [];
  const runningTool = agentTools.find((t) => t.status === 'running');
  const completedTools = agentTools.filter((t) => t.status === 'completed');

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
          {step.qualityGate && !gateResult && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300 flex items-center gap-0.5">
              <Shield size={9} />
              {step.qualityGate.type}
            </span>
          )}
          {gateResult && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
              gateResult.passed
                ? 'bg-green-900/50 text-green-300'
                : 'bg-red-900/50 text-red-300'
            }`}>
              {gateResult.passed ? <ShieldCheck size={9} /> : <ShieldX size={9} />}
              {gateResult.passed ? 'passed' : 'failed'}
            </span>
          )}
        </div>

        {/* Inline agent activity for in_progress steps */}
        {step.status === 'in_progress' && agent && (
          <StepAgentActivity
            startedAt={agent.startedAt}
            runningToolName={runningTool?.toolName}
            completedToolCount={completedTools.length}
            costUsd={agent.costUsd}
          />
        )}

        {/* Completed step metadata */}
        {step.status === 'completed' && agent && (
          <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500">
            {agent.durationMs != null && (
              <span>{formatDuration(agent.durationMs)}</span>
            )}
            {agent.costUsd > 0 && (
              <span>${agent.costUsd.toFixed(4)}</span>
            )}
          </div>
        )}

        {step.resultSummary && (
          <p className={`text-[10px] mt-1 line-clamp-2 ${step.status === 'failed' ? 'text-red-400' : 'text-zinc-500'}`}>{step.resultSummary}</p>
        )}
      </div>
    </div>
  );
}

function StepAgentActivity({
  startedAt,
  runningToolName,
  completedToolCount,
  costUsd,
}: {
  startedAt: number;
  runningToolName?: string;
  completedToolCount: number;
  costUsd: number;
}) {
  const elapsed = useElapsedTime(startedAt);

  return (
    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-400">
      <span className="text-zinc-500">{elapsed}</span>
      {runningToolName && (
        <span className="flex items-center gap-1">
          <Loader2 size={10} className="text-blue-400 animate-spin" />
          <span className="font-mono">{runningToolName}</span>
        </span>
      )}
      {completedToolCount > 0 && (
        <span className="text-zinc-500">{completedToolCount} tools run</span>
      )}
      {costUsd > 0 && (
        <span className="text-zinc-500">${costUsd.toFixed(4)}</span>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}
