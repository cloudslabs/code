import type { AgentNode, AgentToolActivity } from './agent.js';
import type { ProjectListItem, Project, ProjectMetadata, StoredMessage } from './project.js';
import type { ContextBudget } from './context.js';
import type { MemoryEntry } from './memory.js';

// Client → Server messages
export type ClientMessage =
  | ChatSendMessage
  | ChatInterruptMessage
  | ProjectCreateMessage
  | ProjectResumeMessage;

export interface ChatSendMessage {
  type: 'chat:send';
  payload: {
    content: string;
  };
}

export interface ChatInterruptMessage {
  type: 'chat:interrupt';
}

export interface ProjectCreateMessage {
  type: 'project:create';
  payload: {
    workspaceId: string;
    title?: string;
  };
}

export interface ProjectResumeMessage {
  type: 'project:resume';
  payload: {
    projectId: string;
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
  | ContextUpdateMessage
  | ProjectCreatedMessage
  | ProjectResumedMessage
  | ProjectListMessage
  | ProjectMessagesMessage
  | MemoryUpdatedMessage
  | ProjectSettingsUpdatedMessage;

export interface ChatTokenMessage {
  type: 'chat:token';
  payload: {
    token: string;
    agentId: string;
  };
}

export interface ChatMessageComplete {
  type: 'chat:message';
  payload: {
    role: 'user' | 'assistant';
    content: string;
    agentId: string;
    timestamp: number;
  };
}

export interface ChatErrorMessage {
  type: 'chat:error';
  payload: {
    message: string;
    code?: string;
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
  };
}

// Backward compatibility aliases
export type SessionCreateMessage = ProjectCreateMessage;
export type SessionResumeMessage = ProjectResumeMessage;
export type SessionCreatedMessage = ProjectCreatedMessage;
export type SessionResumedMessage = ProjectResumedMessage;
export type SessionListMessage = ProjectListMessage;
export type SessionMessagesMessage = ProjectMessagesMessage;
