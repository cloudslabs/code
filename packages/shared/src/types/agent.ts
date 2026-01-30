export type AgentType = 'orchestrator' | 'code-analyst' | 'implementer' | 'test-runner' | 'researcher';

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted';

export interface AgentNode {
  id: string;
  projectId: string;
  type: AgentType;
  status: AgentStatus;
  parentAgentId: string | null;
  taskDescription: string | null;
  resultSummary: string | null;
  costUsd: number;
  tokens: number;
  durationMs: number | null;
  startedAt: number;
  completedAt: number | null;
  model: string | null;
  responseText: string | null;
  channel?: 'chat' | 'setup' | 'plan';
}

export interface AgentTree {
  orchestrator: AgentNode;
  subagents: AgentNode[];
}

export interface AgentToolActivity {
  id: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
  timestamp: number;
}

export interface AgentContextSection {
  name: string;       // "System Prompt", "Project Context", "Memory", "Workspace Files", "Session Summary", "Task"
  included: boolean;
  content: string | null;
}

export interface ToolCall {
  id: string;
  projectId: string;
  agentId: string;
  toolName: string;
  input: string;
  output: string | null;
  status: string;
  durationMs: number | null;
  startedAt: number;
  completedAt: number | null;
}
