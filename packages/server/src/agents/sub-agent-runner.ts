import { query } from '@anthropic-ai/claude-code';
import type { Options, SDKMessage } from '@anthropic-ai/claude-code';
import type { AgentType, AgentNode } from '@cloudscode/shared';
import { createProjectSettingsMcpServer } from './project-settings-mcp.js';
import { getAgentManager } from './agent-manager.js';
import { createSubAgentHooksConfig } from './hooks.js';
import { buildContextPackage } from './context-builder.js';
import type { ContextHints } from './agent-definitions.js';
import type { Project } from '@cloudscode/shared';
import { getAuthInfo } from '../auth/api-key-provider.js';
import { broadcast } from '../ws.js';
import { logger } from '../logger.js';

export interface SubAgentResult {
  agentId: string;
  agentType: AgentType;
  responseText: string;
  costUsd: number;
  tokens: number;
  status: 'completed' | 'failed' | 'interrupted';
}

export interface SubAgentPlan {
  agentType: Exclude<AgentType, 'orchestrator'>;
  taskDescription: string;
  contextHints?: Partial<ContextHints>;
  model?: string;
}

export interface SubAgentOptions {
  preCreatedAgentNode?: AgentNode;
  agentAbortController?: AbortController;
  channel?: 'setup' | 'chat' | 'plan';
}

/**
 * Runs a single sub-agent as a tracked query() session.
 *
 * - Creates an AgentNode via AgentManager (with parentAgentId + taskDescription)
 *   or uses a pre-created one if provided
 * - Builds context package with targeted system prompt
 * - Runs query() with agent-specific hooks, streaming tokens to the UI
 * - Collects response text and usage stats
 * - Updates agent status on completion/failure
 */
export async function runSubAgent(
  plan: SubAgentPlan,
  project: Project,
  parentAgentId: string,
  abortSignal: AbortSignal,
  cwd: string,
  options?: SubAgentOptions,
): Promise<SubAgentResult> {
  const agentManager = getAgentManager();

  // Use pre-created agent node or create a new one
  const agentNode: AgentNode = options?.preCreatedAgentNode ?? agentManager.createAgent(
    project.id,
    plan.agentType,
    parentAgentId,
    plan.taskDescription,
    plan.model ?? null,
  );

  // Build targeted context package
  const contextPackage = buildContextPackage(
    project,
    plan.agentType,
    plan.taskDescription,
    plan.contextHints,
  );

  // Broadcast context sections to the UI
  broadcast({
    type: 'agent:context',
    payload: {
      agentId: agentNode.id,
      sections: contextPackage.sections,
    },
  });

  // Persist context sections to database
  agentManager.setAgentContextSections(agentNode.id, contextPackage.sections);

  // Create hooks that attribute tool calls to this sub-agent
  const hooks = createSubAgentHooksConfig(agentNode.id, project.id);

  // Build environment
  const env = buildEnv();

  // Conditionally include project-settings MCP for implementer and code-analyst
  const mcpServers: Options['mcpServers'] = {};
  if (plan.agentType === 'implementer' || plan.agentType === 'code-analyst') {
    mcpServers['project-settings'] = createProjectSettingsMcpServer(project.id);
  }

  // Use provided abort controller or create one that forwards from parent signal
  const abortController = options?.agentAbortController ?? new AbortController();
  const onAbort = () => abortController.abort();
  abortSignal.addEventListener('abort', onAbort, { once: true });

  const queryOptions: Options = {
    abortController,
    customSystemPrompt: contextPackage.systemPrompt,
    cwd,
    permissionMode: 'bypassPermissions',
    model: (plan.model ?? 'sonnet') as any,
    maxTurns: 30,
    hooks,
    includePartialMessages: true,
    env,
    mcpServers,
    stderr: (data: string) => {
      logger.warn({ stderr: data.trim(), agentId: agentNode.id }, 'Sub-agent subprocess stderr');
    },
  };

  let responseText = '';
  let costUsd = 0;
  let tokens = 0;

  try {
    const agentQuery = query({ prompt: plan.taskDescription, options: queryOptions });

    for await (const message of agentQuery) {
      // Check abort before processing (global or per-agent)
      if (abortSignal.aborted || abortController.signal.aborted) {
        break;
      }

      processSubAgentMessage(message, agentNode.id, options?.channel);

      // Collect response text
      if (message.type === 'assistant' && message.message.content) {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            responseText += block.text;
          }
        }
      }

      // Handle result
      if (message.type === 'result') {
        const result = message as any;
        if (result.subtype === 'success') {
          costUsd = result.total_cost_usd ?? 0;
          tokens = result.usage?.input_tokens ?? 0;

          agentManager.updateAgentCost(agentNode.id, costUsd, tokens);
          agentManager.setAgentResponse(agentNode.id, responseText);
          agentManager.updateAgentStatus(agentNode.id, 'completed', responseText.slice(0, 500));

          return {
            agentId: agentNode.id,
            agentType: plan.agentType,
            responseText,
            costUsd,
            tokens,
            status: 'completed',
          };
        } else {
          agentManager.updateAgentStatus(agentNode.id, 'failed');
          return {
            agentId: agentNode.id,
            agentType: plan.agentType,
            responseText,
            costUsd: result.total_cost_usd ?? 0,
            tokens: result.usage?.input_tokens ?? 0,
            status: 'failed',
          };
        }
      }
    }

    // If we exited the loop due to abort (global or per-agent)
    if (abortSignal.aborted || abortController.signal.aborted) {
      agentManager.updateAgentStatus(agentNode.id, 'interrupted');
      return {
        agentId: agentNode.id,
        agentType: plan.agentType,
        responseText,
        costUsd,
        tokens,
        status: 'interrupted',
      };
    }

    // Normal exit without explicit result message
    agentManager.setAgentResponse(agentNode.id, responseText);
    agentManager.updateAgentStatus(agentNode.id, 'completed', responseText.slice(0, 500));
    return {
      agentId: agentNode.id,
      agentType: plan.agentType,
      responseText,
      costUsd,
      tokens,
      status: 'completed',
    };
  } catch (err) {
    logger.error({ err, agentId: agentNode.id }, 'Sub-agent query error');

    if (abortSignal.aborted || abortController.signal.aborted) {
      agentManager.updateAgentStatus(agentNode.id, 'interrupted');
      return {
        agentId: agentNode.id,
        agentType: plan.agentType,
        responseText,
        costUsd,
        tokens,
        status: 'interrupted',
      };
    }

    agentManager.updateAgentStatus(agentNode.id, 'failed');
    return {
      agentId: agentNode.id,
      agentType: plan.agentType,
      responseText,
      costUsd,
      tokens,
      status: 'failed',
    };
  } finally {
    abortSignal.removeEventListener('abort', onAbort);
  }
}

/**
 * Processes SDK messages from a sub-agent, broadcasting streaming tokens
 * attributed to the sub-agent's ID.
 */
function processSubAgentMessage(message: SDKMessage, agentId: string, channel?: 'setup' | 'chat' | 'plan'): void {
  switch (message.type) {
    case 'stream_event': {
      const event = (message as any).event;
      if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
        broadcast({
          type: 'chat:token',
          payload: {
            token: event.delta.text,
            agentId,
            ...(channel ? { channel } : {}),
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
            agentId,
            timestamp: Date.now(),
            ...(channel ? { channel } : {}),
          },
        });
      }
      break;
    }

    case 'system': {
      logger.debug({ subtype: (message as any).subtype, agentId }, 'Sub-agent system message');
      break;
    }
  }
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }

  const auth = getAuthInfo();
  if (auth.type === 'api_key' && auth.token) {
    env.ANTHROPIC_API_KEY = auth.token;
  }

  return env;
}
