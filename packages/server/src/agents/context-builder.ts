import type { AgentType, AgentContextSection, Project } from '@cloudscode/shared';
import { getAgentDefinition, type ContextHints } from './agent-definitions.js';
import { getContextManager } from '../context/context-manager.js';
import { getSummaryCache } from '../context/summary-cache.js';
import { getWorkspaceFiles } from '../workspace/workspace-files.js';
import { getProjectManager } from '../projects/project-manager.js';
import { logger } from '../logger.js';

const MAX_CONVERSATION_CONTEXT_LENGTH = 500;

export interface ContextPackage {
  systemPrompt: string;
  agentType: AgentType;
  sections: AgentContextSection[];
}

/**
 * Builds a context package for a sub-agent, assembling the system prompt
 * with conditionally included context sections based on agent defaults
 * and per-task overrides.
 */
export function buildContextPackage(
  project: Project,
  agentType: Exclude<AgentType, 'orchestrator'>,
  taskDescription: string,
  contextHintOverrides?: Partial<ContextHints>,
): ContextPackage {
  const definition = getAgentDefinition(agentType);

  // Merge per-task hint overrides with agent defaults
  const hints: ContextHints = {
    ...definition.defaultContextHints,
    ...contextHintOverrides,
  };

  const parts: string[] = [definition.systemPrompt];
  const sections: AgentContextSection[] = [];

  // System prompt (always included)
  sections.push({ name: 'System Prompt', included: true, content: definition.systemPrompt });

  // Task description
  parts.push(`\n\n## Your Task\n${taskDescription}`);
  sections.push({ name: 'Task', included: true, content: taskDescription });

  // Project context (name, purpose, language, architecture, conventions, tech stack)
  if (hints.projectContext) {
    const projectCtx = buildProjectContext(project);
    if (projectCtx) {
      parts.push(`\n\n## Project Context\n${projectCtx}`);
    }
    sections.push({ name: 'Project Context', included: true, content: projectCtx });
  } else {
    sections.push({ name: 'Project Context', included: false, content: null });
  }

  // Workspace files (PROJECT.md, CONVENTIONS.md)
  if (hints.workspaceFiles) {
    let wsContent: string | null = null;
    try {
      const workspaceFiles = getWorkspaceFiles();
      const wsContext = workspaceFiles.getContext();
      if (wsContext) {
        parts.push(`\n\n## Workspace Files\n${wsContext}`);
        wsContent = wsContext;
      }
    } catch {
      // WorkspaceFiles may not be initialized
      logger.debug('WorkspaceFiles not available for context package');
    }
    sections.push({ name: 'Workspace Files', included: true, content: wsContent });
  } else {
    sections.push({ name: 'Workspace Files', included: false, content: null });
  }

  // Memory context (FTS5 search against task description)
  if (hints.memory) {
    let memContent: string | null = null;
    try {
      const contextManager = getContextManager();
      const memoryCtx = contextManager.getMemoryContext(project.workspaceId, taskDescription, project.id);
      if (memoryCtx) {
        parts.push(`\n\n## Project Knowledge\n${memoryCtx}`);
        memContent = memoryCtx;
      }
    } catch {
      logger.debug('ContextManager not available for memory context');
    }
    sections.push({ name: 'Memory', included: true, content: memContent });
  } else {
    sections.push({ name: 'Memory', included: false, content: null });
  }

  // Session summary
  if (hints.summary) {
    let summaryContent: string | null = null;
    try {
      const summaryCache = getSummaryCache();
      const summary = summaryCache.getSummary(project.id);
      if (summary) {
        parts.push(`\n\n## Session State\n${summary}`);
        summaryContent = summary;
      }
    } catch {
      logger.debug('SummaryCache not available for context package');
    }
    sections.push({ name: 'Session Summary', included: true, content: summaryContent });
  } else {
    sections.push({ name: 'Session Summary', included: false, content: null });
  }

  // Conversation context (recent chat messages)
  if (hints.conversationContext) {
    let convContent: string | null = null;
    try {
      const projectManager = getProjectManager();
      const recentMessages = projectManager.getRecentMessages(project.id, 10);
      if (recentMessages.length > 0) {
        const formatted = recentMessages.map((m) => {
          const content = m.content.length > MAX_CONVERSATION_CONTEXT_LENGTH
            ? m.content.slice(0, MAX_CONVERSATION_CONTEXT_LENGTH) + '...'
            : m.content;
          return `${m.role}: ${content}`;
        }).join('\n');
        parts.push(`\n\n## Recent Conversation\n${formatted}`);
        convContent = formatted;
      }
    } catch {
      logger.debug('ProjectManager not available for conversation context');
    }
    sections.push({ name: 'Conversation', included: true, content: convContent });
  } else {
    sections.push({ name: 'Conversation', included: false, content: null });
  }

  return {
    systemPrompt: parts.join(''),
    agentType,
    sections,
  };
}

/**
 * Builds project context string from project metadata.
 * Extracted from the old orchestrator.ts buildProjectContext() method.
 */
export function buildProjectContext(project: Project): string | null {
  const parts: string[] = [];

  if (project.title) parts.push(`Name: ${project.title}`);
  if (project.purpose) parts.push(`Purpose: ${project.purpose}`);
  if (project.primaryLanguage) parts.push(`Primary language: ${project.primaryLanguage}`);
  if (project.architecturePattern) parts.push(`Architecture: ${project.architecturePattern}`);

  const meta = project.metadata;

  // AI custom instructions
  if (meta.ai?.customInstructions) {
    parts.push(`\nAI Instructions: ${meta.ai.customInstructions}`);
  }

  // Avoid paths
  if (meta.ai?.avoidPaths && meta.ai.avoidPaths.length > 0) {
    parts.push(`Avoid paths: ${meta.ai.avoidPaths.join(', ')}`);
  }

  // Key conventions (top 5)
  if (meta.codingStandards && meta.codingStandards.length > 0) {
    const top = meta.codingStandards.slice(0, 5);
    parts.push(`\nConventions:\n${top.map((s) => `- ${s.rule}: ${s.description}`).join('\n')}`);
  }

  // Active services
  if (meta.services && meta.services.length > 0) {
    parts.push(`Services: ${meta.services.map((s) => s.name).join(', ')}`);
  }

  // Tech stack
  if (meta.techStack && meta.techStack.length > 0) {
    const primary = meta.techStack.filter((t) => t.isPrimary);
    if (primary.length > 0) {
      parts.push(`Tech stack: ${primary.map((t) => `${t.name}${t.version ? ` ${t.version}` : ''}`).join(', ')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}
