import type { AgentNode, AgentToolActivity, AgentContextSection, ToolCall } from './agent.js';
import type { ProjectListItem, Project, ProjectMetadata, StoredMessage } from './project.js';
import type { ContextBudget } from './context.js';
import type { MemoryEntry } from './memory.js';
import type { Plan, PlanStep, PlanListItem } from './plan.js';

// Client → Server messages
export type ClientMessage =
  | ChatSendMessage
  | ChatInterruptMessage
  | AgentInterruptMessage
  | ProjectCreateMessage
  | ProjectResumeMessage
  | ProjectSkipSetupMessage
  | PlanSendMessage
  | PlanInterruptMessage
  | PlanApproveMessage
  | PlanSaveMessage
  | PlanCancelMessage
  | PlanExecuteMessage;

export interface ChatSendMessage {
  type: 'chat:send';
  payload: {
    content: string;
    model?: string;
  };
}

export interface ChatInterruptMessage {
  type: 'chat:interrupt';
}

export interface AgentInterruptMessage {
  type: 'agent:interrupt';
  payload: { agentId: string };
}

export interface ProjectCreateMessage {
  type: 'project:create';
  payload: {
    workspaceId: string;
    title?: string;
    skipSetup?: boolean;
  };
}

export interface ProjectResumeMessage {
  type: 'project:resume';
  payload: {
    projectId: string;
  };
}

export interface ProjectSkipSetupMessage {
  type: 'project:skip_setup';
}

export interface PlanSendMessage {
  type: 'plan:send';
  payload: {
    content: string;
    model?: string;
  };
}

export interface PlanInterruptMessage {
  type: 'plan:interrupt';
}

export interface PlanApproveMessage {
  type: 'plan:approve';
  payload: {
    planId: string;
  };
}

export interface PlanSaveMessage {
  type: 'plan:save';
}

export interface PlanCancelMessage {
  type: 'plan:cancel';
}

export interface PlanExecuteMessage {
  type: 'plan:execute';
  payload: {
    planId: string;
  };
}

// Server → Client messages
export type ServerMessage =
  | ChatTokenMessage
  | ChatMessageComplete
  | ChatErrorMessage
  | AgentStartedMessage
  | AgentStoppedMessage
  | AgentResultMessage
  | AgentToolMessage
  | AgentToolResultMessage
  | ContextUpdateMessage
  | ProjectCreatedMessage
  | ProjectResumedMessage
  | ProjectListMessage
  | ProjectMessagesMessage
  | ProjectAgentsMessage
  | MemoryUpdatedMessage
  | AgentContextMessage
  | ProjectSettingsUpdatedMessage
  | ProjectSetupCompletedMessage
  | PlanUpdatedMessage
  | PlanStepUpdatedMessage
  | PlanExecutionStartedMessage
  | PlanExecutionCompletedMessage
  | PlanSavedMessage
  | PlanListMessage
  | ProjectPlanMessagesMessage;

export interface ChatTokenMessage {
  type: 'chat:token';
  payload: {
    token: string;
    agentId: string;
    channel?: 'setup' | 'chat' | 'plan';
  };
}

export interface ChatMessageComplete {
  type: 'chat:message';
  payload: {
    role: 'user' | 'assistant';
    content: string;
    agentId: string;
    timestamp: number;
    channel?: 'setup' | 'chat' | 'plan';
  };
}

export interface ChatErrorMessage {
  type: 'chat:error';
  payload: {
    message: string;
    code?: string;
    channel?: 'setup' | 'chat' | 'plan';
  };
}

export interface AgentStartedMessage {
  type: 'agent:started';
  payload: AgentNode;
}

export interface AgentStoppedMessage {
  type: 'agent:stopped';
  payload: AgentNode;
}

export interface AgentResultMessage {
  type: 'agent:result';
  payload: {
    agentId: string;
    summary: string;
  };
}

export interface AgentToolMessage {
  type: 'agent:tool';
  payload: AgentToolActivity;
}

export interface AgentToolResultMessage {
  type: 'agent:tool_result';
  payload: {
    toolCallId: string;
    agentId: string;
    toolName: string;
    output: unknown;
    status: 'completed' | 'failed';
    durationMs: number;
  };
}

export interface AgentContextMessage {
  type: 'agent:context';
  payload: {
    agentId: string;
    sections: AgentContextSection[];
  };
}

export interface ProjectAgentsMessage {
  type: 'project:agents';
  payload: {
    projectId: string;
    agents: AgentNode[];
    toolCalls: ToolCall[];
    contextSections?: Record<string, AgentContextSection[]>;
  };
}

export interface ContextUpdateMessage {
  type: 'context:update';
  payload: ContextBudget;
}

export interface ProjectCreatedMessage {
  type: 'project:created';
  payload: Project;
}

export interface ProjectResumedMessage {
  type: 'project:resumed';
  payload: Project;
}

export interface ProjectListMessage {
  type: 'project:list';
  payload: {
    projects: ProjectListItem[];
  };
}

export interface ProjectMessagesMessage {
  type: 'project:messages';
  payload: {
    projectId: string;
    messages: StoredMessage[];
  };
}

export interface ProjectPlanMessagesMessage {
  type: 'project:plan_messages';
  payload: {
    projectId: string;
    messages: StoredMessage[];
  };
}

export interface MemoryUpdatedMessage {
  type: 'memory:updated';
  payload: {
    entry: MemoryEntry;
    action: 'created' | 'updated' | 'deleted';
  };
}

export interface ProjectSettingsUpdatedMessage {
  type: 'project:settings_updated';
  payload: {
    projectId: string;
    category: string | null; // null for top-level field updates
    data: unknown;
    fullMetadata: ProjectMetadata;
    projectFields?: Partial<Pick<Project, 'title' | 'description' | 'purpose' | 'primaryLanguage' | 'architecturePattern' | 'directoryPath'>>;
  };
}

export interface ProjectSetupCompletedMessage {
  type: 'project:setup_completed';
  payload: {
    projectId: string;
  };
}

export interface PlanUpdatedMessage {
  type: 'plan:updated';
  payload: Plan;
}

export interface PlanStepUpdatedMessage {
  type: 'plan:step_updated';
  payload: {
    planId: string;
    step: PlanStep;
  };
}

export interface PlanExecutionStartedMessage {
  type: 'plan:execution_started';
  payload: {
    planId: string;
  };
}

export interface PlanExecutionCompletedMessage {
  type: 'plan:execution_completed';
  payload: {
    planId: string;
    status: 'completed' | 'failed';
  };
}

export interface PlanSavedMessage {
  type: 'plan:saved';
  payload: Plan;
}

export interface PlanListMessage {
  type: 'plan:list';
  payload: {
    projectId: string;
    plans: PlanListItem[];
  };
}

// Backward compatibility aliases
export type SessionCreateMessage = ProjectCreateMessage;
export type SessionResumeMessage = ProjectResumeMessage;
export type SessionCreatedMessage = ProjectCreatedMessage;
export type SessionResumedMessage = ProjectResumedMessage;
export type SessionListMessage = ProjectListMessage;
export type SessionMessagesMessage = ProjectMessagesMessage;
