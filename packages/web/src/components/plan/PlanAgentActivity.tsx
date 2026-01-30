import { useState } from 'react';
import { usePlanPanelStore } from '../../stores/plan-panel-store.js';
import type { AgentNode, AgentToolActivity } from '@cloudscode/shared';

function AgentStatusIcon({ status }: { status: AgentNode['status'] }) {
  switch (status) {
    case 'running':
      return <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />;
    case 'completed':
      return <span className="inline-block w-2 h-2 rounded-full bg-green-400" />;
    case 'failed':
      return <span className="inline-block w-2 h-2 rounded-full bg-red-400" />;
    case 'interrupted':
      return <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />;
    default:
      return <span className="inline-block w-2 h-2 rounded-full bg-zinc-500" />;
  }
}

function ToolActivityItem({ activity }: { activity: AgentToolActivity }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-400 pl-4">
      {activity.status === 'running' ? (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      ) : activity.status === 'completed' ? (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
      ) : (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
      )}
      <span className="font-mono">{activity.toolName}</span>
      {activity.durationMs != null && (
        <span className="text-zinc-500">({activity.durationMs}ms)</span>
      )}
    </div>
  );
}

export function PlanAgentActivity() {
  const planAgents = usePlanPanelStore((s) => s.planAgents);
  const planToolActivity = usePlanPanelStore((s) => s.planToolActivity);
  const [expanded, setExpanded] = useState(true);

  const agents = Array.from(planAgents.values());
  if (agents.length === 0) return null;

  const runningAgents = agents.filter((a) => a.status === 'running');
  const hasRunning = runningAgents.length > 0;

  return (
    <div className="border-b border-zinc-700 px-3 py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left text-xs font-medium text-zinc-300 hover:text-zinc-100"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
        <span>Research Agents</span>
        {hasRunning && (
          <span className="text-blue-400 animate-pulse">
            ({runningAgents.length} running)
          </span>
        )}
        {!hasRunning && (
          <span className="text-zinc-500">({agents.length} total)</span>
        )}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1">
          {agents.map((agent) => {
            const agentTools = planToolActivity.filter((t) => t.agentId === agent.id);
            const latestTool = agentTools.length > 0 ? agentTools[agentTools.length - 1] : null;

            return (
              <div key={agent.id} className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs text-zinc-300">
                  <AgentStatusIcon status={agent.status} />
                  <span className="font-medium">{agent.type}</span>
                  {agent.taskDescription && (
                    <span className="text-zinc-500 truncate max-w-[300px]">
                      — {agent.taskDescription}
                    </span>
                  )}
                </div>
                {latestTool && latestTool.status === 'running' && (
                  <ToolActivityItem activity={latestTool} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
