import { query } from '@anthropic-ai/claude-code';
import type { Query, SDKMessage, Options } from '@anthropic-ai/claude-code';
import { createProjectSettingsMcpServer } from './project-settings-mcp.js';
import type { WebSocket } from 'ws';
import type { Project } from '@cloudscode/shared';
import type { Config } from '../config.js';
import { getAgentManager } from './agent-manager.js';
import { createHooksConfig } from './hooks.js';
import { getContextManager } from '../context/context-manager.js';
import { getSummaryCache } from '../context/summary-cache.js';
import { getWorkspaceFiles } from '../workspace/workspace-files.js';
import { getKnowledgeExtractor } from '../context/knowledge-extractor.js';
import { getProjectManager } from '../projects/project-manager.js';
import { getAuthInfo, hasValidAuth } from '../auth/api-key-provider.js';
import { broadcast, sendTo } from '../ws.js';
import { logger } from '../logger.js';

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the orchestrator for a development workspace. Your role:
1. Understand the user's high-level intent
2. Delegate complex or multi-file tasks to subagents using the Task tool
3. Synthesize subagent results into coherent responses
4. Handle simple questions and small edits directly

Delegation guidelines:
- Delegate when: >3 files involved, multiple distinct steps, deep analysis needed
- Use code-analyst for exploration, pattern finding, dependency tracing
- Use implementer for writing/modifying code
- Use test-runner for running tests and analyzing failures
- Use researcher for external documentation and solutions

Always provide clear, actionable responses. When delegating, explain what you're doing and synthesize results.`;

const SETTINGS_TOOLS_PROMPT = `

## Project Settings Tools

You have access to project settings tools via the project-settings MCP server. Use them proactively to persist project decisions as the user discusses them.

### Available Tools
- **get_project_settings**: Read current settings. Provide a category name or omit to get all.
- **update_project_settings**: Update a metadata category with merge/replace/remove modes.
- **set_project_info**: Update top-level fields (title, description, purpose, primaryLanguage, architecturePattern).

### Category Mapping Guide
- Framework/library choices → techStack (role: "framework", "library", "runtime", "build tool", etc.)
- Package manager (npm/pnpm/yarn/bun) → packageManager
- Monorepo tool → monorepoTool
- Commit conventions → git (commitConvention: "conventional" | "angular" | "gitmoji" | "freeform")
- Branch naming → git (branchNamingPattern)
- Linters/formatters → linting
- Test frameworks → testing
- Database choices → databases
- API style decisions → apiEndpoints
- Deployment/infra → environments, ciCd, infraAsCode
- Coding rules → codingStandards
- File naming → namingConventions
- Error handling patterns → errorHandling
- Logging framework → logging
- Auth decisions → security
- Architecture style → set_project_info (architecturePattern) or designPatterns
- Project language → set_project_info (primaryLanguage)
- Build tools → build
- Key libraries → keyDependencies

### Behavior
- When the user mentions a technology decision, proactively update settings without being asked.
- Read settings first (get_project_settings) when you need context about what's already configured.
- Use merge mode by default to add new items alongside existing ones.
- Use remove mode when the user says to stop using or remove something.
- Use replace mode only when the user wants to completely overwrite a category.
- Keep confirmations brief: "Updated tech stack" not a paragraph.
- Do NOT ask for confirmation before updating settings — just do it as part of the natural conversation.`;

class Orchestrator {
  private config: Config;
  private currentProject: Project | null = null;
  private currentQuery: Query | null = null;
  private abortController: AbortController | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  setProject(project: Project): void {
    this.currentProject = project;
    logger.info({ projectId: project.id }, 'Orchestrator project set');
  }

  getProject(): Project | null {
    return this.currentProject;
  }

  async handleMessage(content: string, ws: WebSocket): Promise<void> {
    if (!hasValidAuth()) {
      sendTo(ws, {
        type: 'chat:error',
        payload: { message: 'Not authenticated. Please sign in with your Anthropic account.' },
      });
      return;
    }

    if (!this.currentProject) {
      sendTo(ws, {
        type: 'chat:error',
        payload: { message: 'No active project. Create or resume a project first.' },
      });
      return;
    }

    const project = this.currentProject;
    const agentManager = getAgentManager();
    const contextManager = getContextManager();
    const summaryCache = getSummaryCache();
    const workspaceFiles = getWorkspaceFiles();
    const projectManager = getProjectManager();

    // Persist the user message
    projectManager.addMessage(project.id, 'user', content);

    // Create orchestrator agent node for tracking
    const orchestratorNode = agentManager.createAgent(project.id, 'orchestrator');

    // Build context for the system prompt
    const memoryContext = contextManager.getMemoryContext(project.workspaceId, content);
    const projectSummary = summaryCache.getSummary(project.id);
    const workspaceContext = workspaceFiles.getContext();

    // Build the full system prompt with injected context
    const parts: string[] = [ORCHESTRATOR_SYSTEM_PROMPT];

    // Inject structured project metadata
    const projectContextStr = this.buildProjectContext(project);
    if (projectContextStr) {
      parts.push(`\n\nProject context:\n${projectContextStr}`);
    }

    if (workspaceContext) {
      parts.push(`\n\nWorkspace context:\n${workspaceContext}`);
    }

    if (memoryContext) {
      parts.push(`\n\nProject knowledge:\n${memoryContext}`);
    }

    if (projectSummary) {
      parts.push(`\n\nProject state:\n${projectSummary}`);
    }

    // Add project settings tool instructions
    parts.push(SETTINGS_TOOLS_PROMPT);

    const systemPrompt = parts.join('');

    // Set up abort controller
    this.abortController = new AbortController();

    // Check if we can resume a previous SDK session
    const sdkSessionId = projectManager.getSdkSessionId(project.id);

    // Create in-process MCP server for project settings tools
    const settingsMcp = createProjectSettingsMcpServer(project.id);

    // Build query options
    const options: Options = {
      abortController: this.abortController,
      customSystemPrompt: systemPrompt,
      cwd: this.config.PROJECT_ROOT,
      permissionMode: 'bypassPermissions',
      model: 'sonnet',
      maxTurns: 30,
      hooks: createHooksConfig(),
      includePartialMessages: true,
      env: this.buildEnv(),
      mcpServers: {
        'project-settings': settingsMcp,
      },
      ...(sdkSessionId ? { resume: sdkSessionId } : {}),
      stderr: (data: string) => {
        logger.warn({ stderr: data.trim() }, 'Claude Code subprocess stderr');
      },
    };

    try {
      // Start the query
      this.currentQuery = query({ prompt: content, options });
      let fullResponse = '';
      let capturedSdkSessionId = false;

      for await (const message of this.currentQuery) {
        this.processMessage(message, orchestratorNode.id, ws);

        // Capture the SDK session ID from the first message that has one
        if (!capturedSdkSessionId && (message as any).session_id) {
          const newSdkId = (message as any).session_id;
          if (newSdkId && newSdkId !== sdkSessionId) {
            projectManager.setSdkSessionId(project.id, newSdkId);
            logger.info({ projectId: project.id, sdkSessionId: newSdkId }, 'SDK session ID captured');
          }
          capturedSdkSessionId = true;
        }

        // Collect full response for summary
        if (message.type === 'assistant' && message.message.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              fullResponse += block.text;
            }
          }
        }

        // Handle result message
        if (message.type === 'result') {
          const result = message as any;

          // Capture SDK session ID from result if not yet captured
          if (!capturedSdkSessionId && result.session_id) {
            projectManager.setSdkSessionId(project.id, result.session_id);
            capturedSdkSessionId = true;
          }

          if (result.subtype === 'success') {
            agentManager.updateAgentStatus(orchestratorNode.id, 'completed', result.result);
            agentManager.updateAgentCost(
              orchestratorNode.id,
              result.total_cost_usd ?? 0,
              result.usage?.input_tokens ?? 0,
            );

            // Update context budget
            contextManager.updateBudget(project.id, {
              inputTokens: result.usage?.input_tokens ?? 0,
              outputTokens: result.usage?.output_tokens ?? 0,
              cacheReadTokens: result.usage?.cache_read_input_tokens ?? 0,
              cacheWriteTokens: result.usage?.cache_creation_input_tokens ?? 0,
              costUsd: result.total_cost_usd ?? 0,
            });

            // Update project summary
            summaryCache.updateFromResponse(project.id, content, fullResponse);

            // Persist the assistant response
            if (fullResponse) {
              projectManager.addMessage(project.id, 'assistant', fullResponse, orchestratorNode.id);
            }

            // Refresh project state in case settings tools updated it
            const refreshed = projectManager.getProject(project.id);
            if (refreshed) this.currentProject = refreshed;

            // Extract knowledge in background
            if (fullResponse.length > 100) {
              getKnowledgeExtractor().extract(project.workspaceId, project.id, fullResponse).catch((err) => {
                logger.error({ err }, 'Knowledge extraction failed');
              });
            }
          } else {
            agentManager.updateAgentStatus(orchestratorNode.id, 'failed');
            // Still persist partial response if any
            if (fullResponse) {
              projectManager.addMessage(project.id, 'assistant', fullResponse, orchestratorNode.id);
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Query error');
      agentManager.updateAgentStatus(orchestratorNode.id, 'failed');
      sendTo(ws, {
        type: 'chat:error',
        payload: { message: err instanceof Error ? err.message : 'Query failed' },
      });
    } finally {
      this.abortController = null;
    }
  }

  private buildProjectContext(project: Project): string | null {
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

  private processMessage(message: SDKMessage, orchestratorId: string, ws: WebSocket): void {
    switch (message.type) {
      case 'stream_event': {
        const event = (message as any).event;
        // Handle content block delta for streaming
        if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
          broadcast({
            type: 'chat:token',
            payload: {
              token: event.delta.text,
              agentId: orchestratorId,
            },
          });
        }
        break;
      }

      case 'assistant': {
        const assistantMsg = message as any;
        let textContent = '';
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              textContent += block.text;
            }
          }
        }
        if (textContent) {
          broadcast({
            type: 'chat:message',
            payload: {
              role: 'assistant',
              content: textContent,
              agentId: orchestratorId,
              timestamp: Date.now(),
            },
          });
        }
        break;
      }

      case 'system': {
        logger.debug({ subtype: (message as any).subtype }, 'System message');
        break;
      }
    }
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }

    const auth = getAuthInfo();
    if (auth.type === 'api_key' && auth.token) {
      env.ANTHROPIC_API_KEY = auth.token;
    }
    // For OAuth, the subprocess reads ~/.claude/.credentials.json directly

    return env;
  }

  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info('Query interrupted');
    }
  }
}

let orchestrator: Orchestrator;

export function initOrchestrator(config: Config): Orchestrator {
  orchestrator = new Orchestrator(config);
  return orchestrator;
}

export function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    throw new Error('Orchestrator not initialized');
  }
  return orchestrator;
}
