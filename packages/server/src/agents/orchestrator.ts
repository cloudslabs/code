import { query } from '@anthropic-ai/claude-code';
import type { Query, SDKMessage, Options } from '@anthropic-ai/claude-code';
import { createProjectSettingsMcpServer } from './project-settings-mcp.js';
import type { WebSocket } from 'ws';
import type { Project, AgentType, AgentNode, AgentContextSection, ProjectMetadata, StoredMessage, Plan, PlanStep, MemoryEntry } from '@cloudscode/shared';
import type { Config } from '../config.js';
import { getAgentManager } from './agent-manager.js';
import { createHooksConfig } from './hooks.js';
import { getContextManager } from '../context/context-manager.js';
import { getSummaryCache } from '../context/summary-cache.js';
import { getKnowledgeExtractor, type ExtractionComplexity } from '../context/knowledge-extractor.js';
import { getProjectManager } from '../projects/project-manager.js';
import { getAuthInfo, hasValidAuth } from '../auth/api-key-provider.js';
import { buildAuthEnv } from '../auth/build-env.js';
import { getProjectsRootDir } from '../projects/directory-manager.js';
import { broadcast, sendTo } from '../ws.js';
import { getDb } from '../db/database.js';
import { logger } from '../logger.js';
import { runSubAgent, type SubAgentPlan, type SubAgentResult } from './sub-agent-runner.js';
import { agentDefinitions } from './agent-definitions.js';
import { buildProjectContext } from './context-builder.js';
import { getMemoryStore, detectTaskIntent } from '../context/memory-store.js';
import { buildUnifiedKnowledge } from './knowledge-dedup.js';
import { resolveModelId } from './model-utils.js';
import { getWorkspaceFiles } from '../workspace/workspace-files.js';
import { MAX_ROUTING_HISTORY_MESSAGES, MAX_ROUTING_MESSAGE_LENGTH, MAX_MEMORY_INJECTION_ENTRIES, generateId, nowUnix } from '@cloudscode/shared';
import { getPlanManager } from '../plans/plan-manager.js';
import { detectWorkflowIntent } from '../workflows/intent-detector.js';
import { getWorkflowManager } from '../workflows/workflow-manager.js';
import { WorkflowExecutor } from '../workflows/workflow-executor.js';

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

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

const SETUP_SYSTEM_PROMPT = `You are a friendly project setup assistant. Your job is to guide the user through setting up a new project by asking a few quick questions. Keep it conversational and brief.

## Setup Flow

Ask these questions **one at a time**, waiting for the user's response before moving to the next:

1. **Project basics**: Ask for a project name (required), brief description, and purpose. Use the \`set_project_info\` tool to save the answers.

2. **Project directory**: Ask how they want to set up the project directory:
   - **Create new**: Create a fresh directory (use \`setup_project_directory\` with mode "create")
   - **Clone a repo**: Clone from a Git URL (use \`setup_project_directory\` with mode "clone")
   - **Use existing**: Point to an existing directory on disk (use \`setup_project_directory\` with mode "existing")
   {{ROOT_DIR_INFO}}

3. **Tech stack**: Ask about the project's technology choices in one broad question: language, frameworks, databases, testing, package manager, build tools, and linting/formatting. Parse all mentions from the user's response and save EVERY technology immediately:
   - Primary language & architecture → \`set_project_info\` (primaryLanguage, architecturePattern)
   - Frameworks & libraries → \`update_project_settings(category: "techStack")\` with role "framework", "library", "runtime", etc.
   - Databases (e.g. PostgreSQL, MongoDB, Redis) → \`update_project_settings(category: "databases")\`
   - Package manager (npm/pnpm/yarn/bun) → \`update_project_settings(category: "packageManager")\`
   - Build tools (Vite, Webpack, esbuild, etc.) → \`update_project_settings(category: "build")\`
   - Testing frameworks (Jest, Vitest, Playwright, etc.) → \`update_project_settings(category: "testing")\`
   - Linters/formatters (ESLint, Prettier, Biome, etc.) → \`update_project_settings(category: "linting")\`
   Save EVERY technology mentioned using the appropriate tool and category immediately. Don't ask for confirmation — just save them.

4. **Conventions & standards**: Suggest sensible defaults based on the tech stack from step 3, and ask the user to accept, modify, or skip. Cover:
   - Naming conventions (e.g. camelCase for variables, PascalCase for components, kebab-case for files) → \`update_project_settings(category: "namingConventions")\`
   - Coding standards (e.g. "prefer const over let", "use async/await over raw promises") → \`update_project_settings(category: "codingStandards")\`
   - Git conventions (commit style: conventional/angular/gitmoji/freeform, branch naming pattern, default branch) → \`update_project_settings(category: "git")\`
   - Error handling patterns → \`update_project_settings(category: "errorHandling")\`
   Present 3-5 suggested defaults as a short list the user can accept with "looks good" or modify. Save immediately after the user responds.

5. **AI preferences** (optional): Ask if they have any preferences for how the AI assistant should work with their code (coding style, things to avoid, focus areas). Save with \`update_project_settings\` using the "ai" category.

6. **Complete**: When done (or if the user says "skip" at any point), call \`complete_project_setup\`.

## Rules
- Ask **one question at a time** — don't overwhelm the user.
- Keep responses short (2-3 sentences max per question).
- If the user says "skip" or wants to skip remaining questions, immediately call \`complete_project_setup\`.
- Save answers immediately using the appropriate tools — don't wait until the end.
- Start with a brief welcome message and the first question.`;

// ---------------------------------------------------------------------------
// Plan mode system prompt
// ---------------------------------------------------------------------------

const PLAN_SYSTEM_PROMPT = `You are a development planning assistant. Your SOLE purpose is to produce structured development plans. You CANNOT modify code, create files, or execute any changes — you can only research and plan.

## Core Rule
Every conversation in plan mode MUST result in a development plan inside a \`\`\`plan\`\`\` fenced block. This is mandatory — there is no scenario where you do NOT produce a plan.

## Planning Process
1. If the user's request is clear enough, produce a plan IMMEDIATELY — do not ask unnecessary questions.
2. If you genuinely need clarification, ask 1-3 concise questions, then produce a draft plan on your next response.
3. If the user says "do it", "go ahead", "yes", or similar — produce the plan based on conversation context.

## Conversation Continuity
- This conversation may span multiple turns. ALWAYS build upon analysis and context from earlier messages.
- If prior messages contain analysis, findings, or a previously generated plan, reference and leverage that work directly. Do NOT re-analyze or re-read files that were already examined.
- When the user asks to refine, revise, or build upon prior analysis, use the existing conversation history rather than starting from scratch.
- If a current plan exists (provided below as "Current Plan"), treat follow-up requests as revisions unless the user explicitly asks for a new plan from scratch.
- Only perform NEW research when the user asks about something not yet covered.

## Plan Output Format
You MUST output your plan in this exact fenced block format:

\`\`\`plan
{
  "title": "Brief plan title",
  "summary": "One-paragraph summary of what the plan accomplishes",
  "steps": [
    {
      "id": "step-1",
      "title": "Step title",
      "description": "Detailed description of what this step does",
      "agentType": "implementer",
      "estimatedComplexity": "medium",
      "dependencies": []
    },
    {
      "id": "step-2",
      "title": "Another step",
      "description": "Description...",
      "agentType": "code-analyst",
      "estimatedComplexity": "low",
      "dependencies": ["step-1"]
    }
  ]
}
\`\`\`

## Rules
- ALWAYS produce a \`\`\`plan\`\`\` block — this is not optional
- Each step should be atomic and clearly described
- Use dependencies to express ordering constraints between steps
- Valid agentType values: "code-analyst", "implementer", "test-runner", "researcher"
- When revising a plan, output the full revised plan (all steps, not just changed ones)
- NEVER execute code or make changes — only plan
- If you don't have enough information, produce a best-effort draft plan and note assumptions`;

// ---------------------------------------------------------------------------
// Setup progress — builds context-aware progress for setup resumption
// ---------------------------------------------------------------------------

function buildSetupProgress(project: Project, metadata: ProjectMetadata, messages: StoredMessage[]): string {
  const progressLines: string[] = [];

  const step1Done = !!(project.title || project.description || project.purpose);
  const step2Done = !!project.directoryPath;
  const step3Done = !!(project.primaryLanguage || (metadata.techStack && metadata.techStack.length > 0));
  const step4Done = !!((metadata.namingConventions && metadata.namingConventions.length > 0) || (metadata.codingStandards && metadata.codingStandards.length > 0) || metadata.git);
  const step5Done = !!metadata.ai;

  if (step1Done) {
    progressLines.push(`- Step 1 (Project basics): DONE — name: "${project.title ?? ''}", description: "${project.description ?? ''}", purpose: "${project.purpose ?? ''}"`);
  }
  if (step2Done) {
    progressLines.push(`- Step 2 (Project directory): DONE — ${project.directoryPath}`);
  }
  if (step3Done) {
    progressLines.push(`- Step 3 (Tech stack): DONE — language: "${project.primaryLanguage ?? ''}", techStack: ${JSON.stringify(metadata.techStack ?? [])}, databases: ${JSON.stringify(metadata.databases ?? [])}`);
  }
  if (step4Done) {
    progressLines.push(`- Step 4 (Conventions): DONE — namingConventions: ${JSON.stringify(metadata.namingConventions ?? [])}, codingStandards: ${JSON.stringify(metadata.codingStandards ?? [])}, git: ${JSON.stringify(metadata.git ?? null)}`);
  }
  if (step5Done) {
    progressLines.push(`- Step 5 (AI preferences): DONE — ${JSON.stringify(metadata.ai)}`);
  }

  let progressSection = '';

  if (progressLines.length > 0) {
    const nextStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : !step4Done ? 4 : !step5Done ? 5 : 6;
    progressSection += `\n\n## Progress So Far\n${progressLines.join('\n')}\n\n`;
    if (nextStep <= 5) {
      progressSection += `Resume from step ${nextStep}. Do NOT re-ask completed questions. Do NOT repeat the welcome message.\n`;
    } else {
      progressSection += `All questions answered. Call \`complete_project_setup\` to finish.\n`;
    }
  }

  // Include conversation history so the AI can continue naturally even without session resume
  if (messages.length > 0) {
    const historyLines = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    progressSection += `\n\n## Previous Conversation\n${historyLines}\n\nContinue naturally from where the conversation left off.\n`;
  }

  return progressSection;
}

// ---------------------------------------------------------------------------
// Routing prompt — minimal context for Phase 1
// ---------------------------------------------------------------------------

function buildRoutingPrompt(project: Project, chatHistory?: StoredMessage[], memorySummary?: string): string {
  const agentDescriptions = Object.values(agentDefinitions)
    .map((d) => `- **${d.type}**: ${d.description}`)
    .join('\n');

  let historySection = '';
  if (chatHistory && chatHistory.length > 0) {
    const truncated = chatHistory.map((m) => {
      const content = m.content.length > MAX_ROUTING_MESSAGE_LENGTH
        ? m.content.slice(0, MAX_ROUTING_MESSAGE_LENGTH) + '...'
        : m.content;
      return `${m.role}: ${content}`;
    }).join('\n');
    historySection = `\n\n## Recent Conversation\n${truncated}\n\nWhen the user refers to previous discussion, use the conversation above to understand what they mean.`;
  }

  let knowledgeSection = '';
  if (memorySummary) {
    knowledgeSection = `\n\n## Project Knowledge\n${memorySummary}\n\nUse this knowledge to write more specific task descriptions for sub-agents.`;
  }

  return `You are a routing agent for the project "${project.title ?? 'Untitled'}".
Project purpose: ${project.purpose ?? 'General development'}

Your job is to analyze the user's message and decide how to handle it.

## Available Sub-Agents
${agentDescriptions}
${historySection}${knowledgeSection}

## Routing Rules
- For simple greetings, conversational messages, or questions you can answer from the project context alone, respond directly.
- For tasks requiring code reading, analysis, search, or exploration: delegate to code-analyst.
- For tasks requiring code writing, editing, file creation, or modifications: delegate to implementer.
- For tasks requiring running tests or analyzing test output: delegate to test-runner.
- For tasks requiring web research, documentation lookup, or external information: delegate to researcher.
- For complex tasks needing multiple steps, delegate to multiple agents in sequence.
- When delegating, provide a clear, specific task description for each agent. Include any relevant context from the user's message.
- CRITICAL: If the user's message is a short reference (e.g. "do it", "go ahead", "execute"), expand the task description to include the FULL context from the recent conversation. The sub-agent will NOT see the conversation history — it only sees the task description you write.

## Response Format
You MUST respond with valid JSON in one of these formats:

**Direct response** (no agents needed):
\`\`\`json
{"directResponse": "Your response text here"}
\`\`\`

**Delegate to agents** (tools needed):
\`\`\`json
{
  "agents": [
    {"agentType": "code-analyst", "taskDescription": "Detailed task for the agent..."},
    {"agentType": "implementer", "taskDescription": "Detailed task for the agent..."}
  ],
  "synthesisHint": "Brief note on how to combine results for the user"
}
\`\`\`

Respond ONLY with JSON. No other text.`;
}

// ---------------------------------------------------------------------------
// Synthesis prompt — combines sub-agent results
// ---------------------------------------------------------------------------

function buildSynthesisPrompt(
  project: Project,
  userMessage: string,
  results: SubAgentResult[],
  synthesisHint: string,
): string {
  const resultSections = results
    .map((r, i) => `### ${r.agentType} (${r.status})\n${r.responseText || '(no output)'}`)
    .join('\n\n');

  return `You are synthesizing results from sub-agents for the project "${project.title ?? 'Untitled'}".

The user asked: "${userMessage}"

## Sub-Agent Results
${resultSections}

## Synthesis Instructions
${synthesisHint || 'Combine the results into a clear, coherent response for the user.'}

Provide a concise, helpful response that addresses the user's original request. Reference specific findings from the agents. Do not mention the agents themselves — just present the information naturally.`;
}

// ---------------------------------------------------------------------------
// Routing response types
// ---------------------------------------------------------------------------

interface DirectRouteResponse {
  directResponse: string;
}

interface PlanRouteResponse {
  planResponse: string;
}

interface DelegateRouteResponse {
  agents: Array<{
    agentType: Exclude<AgentType, 'orchestrator'>;
    taskDescription: string;
  }>;
  synthesisHint?: string;
}

type RouteResponse = DirectRouteResponse | PlanRouteResponse | DelegateRouteResponse;

function isDirectResponse(r: RouteResponse): r is DirectRouteResponse | PlanRouteResponse {
  return 'directResponse' in r || 'planResponse' in r;
}

function getDirectResponseText(r: DirectRouteResponse | PlanRouteResponse): string {
  if ('planResponse' in r) return r.planResponse;
  return r.directResponse;
}

// ---------------------------------------------------------------------------
// Orchestrator class
// ---------------------------------------------------------------------------

class Orchestrator {
  private config: Config;
  private currentProject: Project | null = null;
  private currentQuery: Query | null = null;
  private abortController: AbortController | null = null;
  private currentAgentNodeId: string | null = null;
  private subAgentAbortControllers = new Map<string, AbortController>();

  // User's model preference (updated on each message)
  private currentModel: string = 'sonnet';

  // Plan mode state
  private planModeActive = false;
  private currentPlan: Plan | null = null;
  private planAbortController: AbortController | null = null;
  private currentPlanSessionId: string | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  getCurrentAgentNodeId(): string | null {
    return this.currentAgentNodeId;
  }

  setProject(project: Project): void {
    this.currentProject = project;
    // Reset plan state on project switch
    this.planModeActive = false;
    this.currentPlan = null;
    this.planAbortController = null;
    this.currentPlanSessionId = null;
    logger.info({ projectId: project.id }, 'Orchestrator project set');
  }

  getProject(): Project | null {
    return this.currentProject;
  }

  // =========================================================================
  // Plan mode public API
  // =========================================================================

  setPlanMode(active: boolean): void {
    this.planModeActive = active;
    if (!active) {
      this.currentPlan = null;
      this.currentPlanSessionId = null;
    }
    logger.info({ planModeActive: active, planSessionId: this.currentPlanSessionId }, 'Plan mode toggled');
  }

  private setPlanModeInternal(active: boolean): void {
    this.planModeActive = active;
    if (!active) {
      this.currentPlan = null;
    }
    logger.info({ planModeActive: active, planSessionId: this.currentPlanSessionId }, 'Plan mode toggled (internal)');
  }

  isPlanMode(): boolean {
    return this.planModeActive;
  }

  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  getCurrentPlanSessionId(): string | null {
    return this.currentPlanSessionId;
  }

  async handlePlanMessage(content: string, ws: WebSocket, opts?: { model?: string; planSessionId?: string }): Promise<void> {
    const model = opts?.model ?? 'sonnet';
    this.currentModel = model;

    if (!this.planModeActive) {
      // New plan session — generate a unique session ID to scope messages
      this.currentPlanSessionId = opts?.planSessionId ?? generateId();
      this.setPlanModeInternal(true);
    }

    if (!hasValidAuth()) {
      sendTo(ws, {
        type: 'chat:error',
        payload: { message: 'Not authenticated.', channel: 'plan' },
      });
      return;
    }

    if (!this.currentProject) {
      sendTo(ws, {
        type: 'chat:error',
        payload: { message: 'No active project.', channel: 'plan' },
      });
      return;
    }

    const project = this.currentProject;

    // Persist the user's plan message scoped to the current plan session
    const projectManager = getProjectManager();
    projectManager.addMessage(project.id, 'user', content, undefined, 'plan', this.currentPlanSessionId ?? undefined);

    // Fire-and-forget workflow suggestion
    this.suggestWorkflow(content, project.id).catch((err) => {
      logger.error({ err }, 'Workflow suggestion failed');
    });

    return this.handlePlanMode(content, ws, project, model);
  }

  private async suggestWorkflow(message: string, projectId: string): Promise<void> {
    try {
      const templates = getWorkflowManager().getTemplatesForProject(projectId);
      const suggestion = await detectWorkflowIntent(message, templates);
      if (suggestion && suggestion.confidence >= 0.6) {
        broadcast({
          type: 'workflow:suggestion',
          payload: {
            projectId,
            templateId: suggestion.templateId,
            templateName: suggestion.templateName,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
          },
        });
      }
    } catch (err) {
      logger.error({ err }, 'suggestWorkflow error');
    }
  }

  async approvePlan(planId: string, ws: WebSocket): Promise<void> {
    const plan = this.currentPlan?.id === planId ? this.currentPlan : getPlanManager().getPlan(planId);
    if (!plan) {
      sendTo(ws, { type: 'chat:error', payload: { message: 'Plan not found' } });
      return;
    }
    return this.executePlan(plan, ws);
  }

  async executeSavedPlan(planId: string, ws: WebSocket): Promise<void> {
    const plan = getPlanManager().getPlan(planId);
    if (!plan) {
      sendTo(ws, { type: 'chat:error', payload: { message: 'Plan not found' } });
      return;
    }
    return this.executePlan(plan, ws);
  }

  async resumeWorkflow(planId: string, ws: WebSocket): Promise<void> {
    const planManager = getPlanManager();
    const plan = planManager.getPlan(planId);
    if (!plan) {
      sendTo(ws, { type: 'chat:error', payload: { message: 'Plan not found' } });
      return;
    }
    if (!plan.workflowMetadata) {
      sendTo(ws, { type: 'chat:error', payload: { message: 'Not a workflow plan' } });
      return;
    }

    // Reset failed/skipped steps after checkpoint to pending
    const checkpoint = plan.workflowMetadata.checkpointStepId;
    let pastCheckpoint = !checkpoint;
    for (const step of plan.steps) {
      if (step.id === checkpoint) {
        pastCheckpoint = true;
        continue;
      }
      if (pastCheckpoint && (step.status === 'failed' || step.status === 'skipped')) {
        step.status = 'pending';
      }
    }
    plan.status = 'ready';
    planManager.updatePlan(plan.id, { steps: plan.steps, status: 'ready' });
    broadcast({ type: 'plan:updated', payload: plan });

    return this.executePlan(plan, ws);
  }

  async savePlan(): Promise<Plan | null> {
    if (!this.currentPlan) return null;

    const planManager = getPlanManager();
    if (this.currentPlan.status === 'drafting') {
      planManager.updatePlan(this.currentPlan.id, { status: 'ready' });
      this.currentPlan.status = 'ready';
    } else {
      planManager.updatePlan(this.currentPlan.id, {
        steps: this.currentPlan.steps,
        status: this.currentPlan.status,
      });
    }

    broadcast({ type: 'plan:saved', payload: this.currentPlan });
    return this.currentPlan;
  }

  interruptPlan(): void {
    if (this.planAbortController) {
      this.planAbortController.abort();
      logger.info('Plan query interrupted');
    }
  }

  cancelPlan(): void {
    this.interruptPlan();
    if (this.currentPlan) {
      const planManager = getPlanManager();
      planManager.updatePlan(this.currentPlan.id, { status: 'cancelled' });
      this.currentPlan.status = 'cancelled';
      broadcast({ type: 'plan:updated', payload: this.currentPlan });
    }
    this.setPlanMode(false);
  }

  async handleMessage(content: string, ws: WebSocket, messageOpts?: { persist?: boolean; model?: string }): Promise<void> {
    const persist = messageOpts?.persist !== false;
    const model = messageOpts?.model ?? 'sonnet';
    this.currentModel = model;

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
    const isSetupMode = !project.setupCompleted;

    // Persist the user message (unless suppressed for auto-trigger)
    const projectManager = getProjectManager();
    if (persist) {
      projectManager.addMessage(project.id, 'user', content);
    }

    if (isSetupMode) {
      return this.handleSetupMode(content, ws, project, model);
    }

    return this.handleNormalMode(content, ws, project, model);
  }

  // =========================================================================
  // SETUP MODE — unchanged, uses query() with settings MCP
  // =========================================================================

  private async handleSetupMode(content: string, ws: WebSocket, project: Project, model: string): Promise<void> {
    const agentManager = getAgentManager();
    const projectManager = getProjectManager();

    // Create orchestrator agent node for tracking
    const orchestratorNode = agentManager.createAgent(project.id, 'orchestrator', null, null, model);
    this.currentAgentNodeId = orchestratorNode.id;

    const rootDir = getProjectsRootDir();
    const rootDirInfo = rootDir
      ? `The projects root directory is configured as: ${rootDir}`
      : 'No projects root directory is configured yet. The user can set one in Settings, or the directory can be set to any absolute path.';

    // Build context-aware system prompt with progress tracking
    const refreshedProject = projectManager.getProject(project.id);
    const meta = (projectManager.getProjectMetadata(project.id) ?? {}) as ProjectMetadata;
    const messages = projectManager.getMessages(project.id);
    const progressSection = buildSetupProgress(refreshedProject ?? project, meta, messages);

    const systemPrompt = SETUP_SYSTEM_PROMPT.replace('{{ROOT_DIR_INFO}}', rootDirInfo) + progressSection + SETTINGS_TOOLS_PROMPT;

    this.abortController = new AbortController();

    const sdkSessionId = projectManager.getSdkSessionId(project.id);
    const settingsMcp = createProjectSettingsMcpServer(project.id);

    const buildOptions = (resumeId?: string): Options => ({
      abortController: this.abortController!,
      customSystemPrompt: systemPrompt,
      cwd: project.directoryPath ?? this.config.PROJECT_ROOT,
      permissionMode: 'bypassPermissions',
      model: resolveModelId(model) as any,
      maxTurns: 30,
      hooks: createHooksConfig(),
      includePartialMessages: true,
      env: this.buildEnv(),
      mcpServers: {
        'project-settings': settingsMcp,
      },
      ...(resumeId ? { resume: resumeId } : {}),
      stderr: (data: string) => {
        logger.warn({ stderr: data.trim() }, 'Claude Code subprocess stderr');
      },
    });

    try {
      // Try with session resumption first; if it fails (stale session), retry without
      const err1 = await this.runSetupQuery(
        content,
        buildOptions(sdkSessionId ?? undefined),
        orchestratorNode.id,
        project,
        ws,
      );

      if (err1 && sdkSessionId) {
        const errMsg = err1 instanceof Error ? err1.message : String(err1);
        logger.warn({ sdkSessionId, err: errMsg }, 'SDK session resume failed, retrying without resume');
        projectManager.setSdkSessionId(project.id, '');

        // Reset abort controller for fresh attempt
        this.abortController = new AbortController();

        const err2 = await this.runSetupQuery(
          content,
          buildOptions(),
          orchestratorNode.id,
          project,
          ws,
        );

        if (err2) {
          throw err2;
        }
      } else if (err1) {
        throw err1;
      }
    } catch (err) {
      logger.error({ err }, 'Setup query error');
      agentManager.updateAgentStatus(orchestratorNode.id, 'failed');
      sendTo(ws, {
        type: 'chat:error',
        payload: { message: err instanceof Error ? err.message : 'Query failed', channel: 'setup' },
      });
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Runs the setup query and processes messages. Returns null on success
   * or the error if the query fails.
   */
  private async runSetupQuery(
    content: string,
    options: Options,
    orchestratorNodeId: string,
    project: Project,
    ws: WebSocket,
  ): Promise<Error | null> {
    const agentManager = getAgentManager();
    const projectManager = getProjectManager();

    try {
      this.currentQuery = query({ prompt: content, options });
      let fullResponse = '';
      let capturedSdkSessionId = false;

      for await (const message of this.currentQuery) {
        this.processMessage(message, orchestratorNodeId, ws, 'setup');

        if (!capturedSdkSessionId && (message as any).session_id) {
          const newSdkId = (message as any).session_id;
          if (newSdkId) {
            projectManager.setSdkSessionId(project.id, newSdkId);
            logger.info({ projectId: project.id, sdkSessionId: newSdkId }, 'SDK session ID captured');
          }
          capturedSdkSessionId = true;
        }

        if (message.type === 'assistant' && message.message.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              fullResponse += block.text;
            }
          }
        }

        if (message.type === 'result') {
          const result = message as any;

          if (!capturedSdkSessionId && result.session_id) {
            projectManager.setSdkSessionId(project.id, result.session_id);
            capturedSdkSessionId = true;
          }

          if (result.subtype === 'success') {
            agentManager.setAgentResponse(orchestratorNodeId, fullResponse);
            agentManager.updateAgentStatus(orchestratorNodeId, 'completed', result.result);

            const setupInputTokens = result.usage?.input_tokens ?? 0;
            const setupOutputTokens = result.usage?.output_tokens ?? 0;
            const setupCacheReadTokens = result.usage?.cache_read_input_tokens ?? 0;
            const setupCacheWriteTokens = result.usage?.cache_creation_input_tokens ?? 0;
            agentManager.updateAgentCost(
              orchestratorNodeId,
              result.total_cost_usd ?? 0,
              setupInputTokens + setupOutputTokens,
            );

            // Update context budget with full token breakdown
            const contextManager = getContextManager();
            contextManager.updateBudget(project.id, {
              inputTokens: setupInputTokens,
              outputTokens: setupOutputTokens,
              cacheReadTokens: setupCacheReadTokens,
              cacheWriteTokens: setupCacheWriteTokens,
              costUsd: result.total_cost_usd ?? 0,
            }, { agentRunId: orchestratorNodeId, agentType: 'orchestrator' });

            if (fullResponse) {
              projectManager.addMessage(project.id, 'assistant', fullResponse, orchestratorNodeId);
            }

            const refreshed = projectManager.getProject(project.id);
            if (refreshed) this.currentProject = refreshed;
          } else {
            agentManager.updateAgentStatus(orchestratorNodeId, 'failed');
            if (fullResponse) {
              projectManager.addMessage(project.id, 'assistant', fullResponse, orchestratorNodeId);
            }
          }
        }
      }

      return null;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  // =========================================================================
  // NORMAL MODE — 3-phase boss-style delegation
  // =========================================================================

  private async handleNormalMode(content: string, ws: WebSocket, project: Project, model: string, channel?: 'chat' | 'setup' | 'plan'): Promise<void> {
    const agentManager = getAgentManager();
    const contextManager = getContextManager();
    const summaryCache = getSummaryCache();
    const projectManager = getProjectManager();

    // Create orchestrator agent node for tracking
    const orchestratorNode = agentManager.createAgent(project.id, 'orchestrator', null, null, model, channel ?? undefined);
    this.currentAgentNodeId = orchestratorNode.id;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      // =====================================================================
      // Phase 1: Route — Direct API call with minimal context
      // =====================================================================
      logger.info({ projectId: project.id }, 'Phase 1: Routing');

      // Fetch recent chat history for routing context
      const recentMessages = projectManager.getRecentMessages(project.id, MAX_ROUTING_HISTORY_MESSAGES);

      // Search memory for routing context — compact summary of keys + categories
      let memorySummary: string | undefined;
      try {
        const memStore = getMemoryStore();
        const intent = detectTaskIntent(content);
        const memResults = memStore.searchByProjectWithIntent(
          project.workspaceId, project.id, content, intent, 8,
        );
        if (memResults.length > 0) {
          memorySummary = memResults
            .map((r) => `[${r.entry.category}] ${r.entry.key}`)
            .join(', ');
        }
      } catch {
        logger.debug('MemoryStore not available for routing context');
      }

      // Broadcast orchestrator context sections to the UI
      const routingPrompt = buildRoutingPrompt(project, recentMessages, memorySummary);
      const chatHistoryContent = recentMessages.length > 0
        ? recentMessages.map((m) => `${m.role}: ${m.content.slice(0, MAX_ROUTING_MESSAGE_LENGTH)}`).join('\n')
        : null;
      const orchestratorSections: AgentContextSection[] = [
        { name: 'System Prompt', included: true, content: routingPrompt },
        { name: 'Task', included: true, content: content },
        { name: 'Chat History', included: recentMessages.length > 0, content: chatHistoryContent },
      ];
      broadcast({
        type: 'agent:context',
        payload: {
          agentId: orchestratorNode.id,
          sections: orchestratorSections,
        },
      });

      // Persist context sections to database
      agentManager.setAgentContextSections(orchestratorNode.id, orchestratorSections);

      const routeResult = await this.routeMessage(content, project, recentMessages, signal as any, model, memorySummary);
      const routingUsage = routeResult.usage ?? { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

      if (signal.aborted) {
        agentManager.updateAgentStatus(orchestratorNode.id, 'interrupted');
        return;
      }

      // =====================================================================
      // Direct response — no agents needed
      // =====================================================================
      if (isDirectResponse(routeResult)) {
        const responseText = getDirectResponseText(routeResult);

        // Stream the response
        broadcast({
          type: 'chat:message',
          payload: {
            role: 'assistant',
            content: responseText,
            agentId: orchestratorNode.id,
            timestamp: Date.now(),
            ...(channel ? { channel } : {}),
          },
        });

        agentManager.setAgentResponse(orchestratorNode.id, responseText);
        agentManager.updateAgentStatus(orchestratorNode.id, 'completed', responseText.slice(0, 500));

        // Persist the response
        projectManager.addMessage(project.id, 'assistant', responseText, orchestratorNode.id, channel);

        // Update budget with routing tokens
        contextManager.updateBudget(project.id, {
          inputTokens: routingUsage.inputTokens,
          outputTokens: routingUsage.outputTokens,
          cacheReadTokens: routingUsage.cacheReadTokens,
          cacheWriteTokens: routingUsage.cacheWriteTokens,
          costUsd: routingUsage.costUsd,
        }, { agentRunId: orchestratorNode.id, agentType: 'orchestrator' });
        agentManager.updateAgentCost(orchestratorNode.id, routingUsage.costUsd, routingUsage.inputTokens + routingUsage.outputTokens);

        // Update summary
        summaryCache.updateFromResponse(project.id, content, responseText);

        return;
      }

      // =====================================================================
      // Phase 2: Execute — Run sub-agents sequentially
      // =====================================================================
      logger.info({ projectId: project.id, agentCount: routeResult.agents.length }, 'Phase 2: Executing sub-agents');

      const cwd = project.directoryPath ?? this.config.PROJECT_ROOT;
      const results: SubAgentResult[] = [];

      for (const agentPlan of routeResult.agents) {
        if (signal.aborted) {
          break;
        }

        const plan: SubAgentPlan = {
          agentType: agentPlan.agentType,
          taskDescription: agentPlan.taskDescription,
          model,
        };

        // Pre-create agent node and per-agent abort controller
        const preCreatedAgentNode = agentManager.createAgent(
          project.id,
          plan.agentType,
          orchestratorNode.id,
          plan.taskDescription,
          plan.model ?? null,
          channel ?? undefined,
        );
        const agentAbortController = new AbortController();
        this.subAgentAbortControllers.set(preCreatedAgentNode.id, agentAbortController);

        const result = await runSubAgent(plan, project, orchestratorNode.id, signal as any, cwd, {
          preCreatedAgentNode,
          agentAbortController,
          ...(channel ? { channel } : {}),
        });

        this.subAgentAbortControllers.delete(preCreatedAgentNode.id);
        results.push(result);

        // If the global signal was aborted, stop processing all agents
        if (signal.aborted) {
          break;
        }

        // If just this agent was interrupted, continue to the next one
        if (result.status === 'interrupted') {
          continue;
        }
      }

      if (signal.aborted) {
        agentManager.updateAgentStatus(orchestratorNode.id, 'interrupted');
        // Still persist partial results
        const partialResponse = results
          .filter((r) => r.responseText)
          .map((r) => r.responseText)
          .join('\n\n');
        if (partialResponse) {
          projectManager.addMessage(project.id, 'assistant', partialResponse, orchestratorNode.id, channel);
        }
        return;
      }

      // =====================================================================
      // Phase 3: Synthesize — Combine results (skip if single agent)
      // =====================================================================
      let finalResponse: string;
      let synthesisUsage = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

      const successfulResults = results.filter((r) => r.responseText);

      if (successfulResults.length === 0) {
        finalResponse = 'I was unable to complete the requested task. The sub-agents did not produce output.';
      } else if (successfulResults.length === 1) {
        // Single agent — use its output directly, no synthesis needed
        finalResponse = successfulResults[0].responseText;
      } else {
        // Multiple agents — synthesize results
        logger.info({ projectId: project.id }, 'Phase 3: Synthesizing results');

        const synthesisResult = await this.synthesizeResults(
          content,
          project,
          successfulResults,
          routeResult.synthesisHint ?? '',
          signal as any,
          model,
        );
        finalResponse = synthesisResult.text;
        synthesisUsage = { costUsd: synthesisResult.costUsd, inputTokens: synthesisResult.inputTokens, outputTokens: synthesisResult.outputTokens, cacheReadTokens: synthesisResult.cacheReadTokens, cacheWriteTokens: synthesisResult.cacheWriteTokens };

        if (signal.aborted) {
          agentManager.updateAgentStatus(orchestratorNode.id, 'interrupted');
          return;
        }

        // Broadcast synthesized response
        broadcast({
          type: 'chat:message',
          payload: {
            role: 'assistant',
            content: finalResponse,
            agentId: orchestratorNode.id,
            timestamp: Date.now(),
            ...(channel ? { channel } : {}),
          },
        });
      }

      // =====================================================================
      // Post-processing
      // =====================================================================

      // Aggregate costs from sub-agents + routing + synthesis
      const subAgentCost = results.reduce((sum, r) => sum + r.costUsd, 0);
      const subAgentInputTokens = results.reduce((sum, r) => sum + r.inputTokens, 0);
      const subAgentOutputTokens = results.reduce((sum, r) => sum + r.outputTokens, 0);
      const subAgentCacheReadTokens = results.reduce((sum, r) => sum + r.cacheReadTokens, 0);
      const subAgentCacheWriteTokens = results.reduce((sum, r) => sum + r.cacheWriteTokens, 0);

      const totalCost = subAgentCost + routingUsage.costUsd + synthesisUsage.costUsd;
      const totalInputTokens = subAgentInputTokens + routingUsage.inputTokens + synthesisUsage.inputTokens;
      const totalOutputTokens = subAgentOutputTokens + routingUsage.outputTokens + synthesisUsage.outputTokens;
      const totalCacheReadTokens = subAgentCacheReadTokens + routingUsage.cacheReadTokens + synthesisUsage.cacheReadTokens;
      const totalCacheWriteTokens = subAgentCacheWriteTokens + routingUsage.cacheWriteTokens + synthesisUsage.cacheWriteTokens;

      agentManager.updateAgentCost(orchestratorNode.id, totalCost, totalInputTokens + totalOutputTokens);
      agentManager.setAgentResponse(orchestratorNode.id, finalResponse);
      agentManager.updateAgentStatus(orchestratorNode.id, 'completed', finalResponse.slice(0, 500));

      // Update context budget
      contextManager.updateBudget(project.id, {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: totalCacheReadTokens,
        cacheWriteTokens: totalCacheWriteTokens,
        costUsd: totalCost,
      }, { agentRunId: orchestratorNode.id, agentType: 'orchestrator' });

      // Update per-agent breakdown
      for (const r of results) {
        contextManager.updateAgentUsage(project.id, r.agentId, r.agentType, {
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cacheReadTokens: r.cacheReadTokens,
          cacheWriteTokens: r.cacheWriteTokens,
          costUsd: r.costUsd,
        });
      }

      // Update summary
      summaryCache.updateFromResponse(project.id, content, finalResponse);

      // Persist the final response
      projectManager.addMessage(project.id, 'assistant', finalResponse, orchestratorNode.id, channel);

      // Refresh project state in case settings tools updated it
      const refreshed = projectManager.getProject(project.id);
      if (refreshed) this.currentProject = refreshed;

      // Extract knowledge in background
      if (finalResponse.length > 100) {
        const complexity: ExtractionComplexity =
          finalResponse.length > 3000 ? 'medium' : 'low';
        getKnowledgeExtractor().extract(project.workspaceId, project.id, finalResponse, complexity).catch((err) => {
          logger.error({ err }, 'Knowledge extraction failed');
        });
      }
    } catch (err) {
      logger.error({ err }, 'Orchestrator error');
      agentManager.updateAgentStatus(orchestratorNode.id, 'failed');
      sendTo(ws, {
        type: 'chat:error',
        payload: { message: err instanceof Error ? err.message : 'Query failed', ...(channel ? { channel } : {}) },
      });
    } finally {
      this.abortController = null;
      this.subAgentAbortControllers.clear();
    }
  }

  // =========================================================================
  // Phase 1: Route — Direct Anthropic API call
  // =========================================================================

  private async routeMessage(
    content: string,
    project: Project,
    chatHistory: StoredMessage[],
    signal: AbortSignal,
    model: string = 'sonnet',
    memorySummary?: string,
  ): Promise<RouteResponse & { usage?: { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } }> {
    const routingPrompt = buildRoutingPrompt(project, chatHistory, memorySummary);

    let responseText = '';
    try {
      const q = query({
        prompt: content,
        options: {
          customSystemPrompt: routingPrompt,
          permissionMode: 'plan',
          model: resolveModelId(model),
          maxTurns: 1,
          includePartialMessages: true,
          cwd: project.directoryPath ?? this.config.PROJECT_ROOT,
          env: this.buildEnv(),
          abortController: this.abortController ?? undefined,
        },
      });

      const collected = await this.collectQueryText(q, signal);
      responseText = collected.text;
      const { costUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = collected;
      const usage = { costUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };

      if (signal.aborted) {
        return { directResponse: '', usage };
      }

      // Parse JSON from response — try multiple extraction strategies
      let jsonStr: string;

      // Strategy 1: Extract content inside a markdown code fence
      const fenceMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      } else {
        // Strategy 2: Find the first '{' and last matching '}' to extract the JSON object
        const firstBrace = responseText.indexOf('{');
        const lastBrace = responseText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = responseText.slice(firstBrace, lastBrace + 1);
        } else {
          // Strategy 3: Fall back to trimmed raw text
          jsonStr = responseText.trim();
        }
      }

      const parsed = JSON.parse(jsonStr) as RouteResponse;

      // Validate the response
      if (isDirectResponse(parsed)) {
        return { ...parsed, usage };
      }

      // Validate agent types
      const validTypes = new Set<string>(['code-analyst', 'implementer', 'test-runner', 'researcher']);
      const validatedAgents = parsed.agents.filter((a) => validTypes.has(a.agentType));

      if (validatedAgents.length === 0) {
        // Fallback to direct response if no valid agents
        return { directResponse: responseText, usage };
      }

      return {
        agents: validatedAgents,
        synthesisHint: parsed.synthesisHint,
        usage,
      };
    } catch (err) {
      logger.error({ err, responseText: responseText.slice(0, 500) }, 'Routing API call failed — falling back to code-analyst');

      // Fallback: treat as a direct response
      // If routing fails, delegate to a code-analyst as a safe default
      return {
        agents: [{
          agentType: 'code-analyst',
          taskDescription: content,
        }],
      };
    }
  }

  // =========================================================================
  // Phase 3: Synthesize — Direct Anthropic API call
  // =========================================================================

  private async synthesizeResults(
    userMessage: string,
    project: Project,
    results: SubAgentResult[],
    synthesisHint: string,
    signal: AbortSignal,
    model: string = 'sonnet',
  ): Promise<{ text: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }> {
    const prompt = buildSynthesisPrompt(project, userMessage, results, synthesisHint);

    try {
      const q = query({
        prompt,
        options: {
          customSystemPrompt: 'You synthesize results from development agents into clear, helpful responses.',
          permissionMode: 'plan',
          model: resolveModelId(model),
          maxTurns: 1,
          includePartialMessages: true,
          cwd: project.directoryPath ?? this.config.PROJECT_ROOT,
          env: this.buildEnv(),
          abortController: this.abortController ?? undefined,
        },
      });

      const collected = await this.collectQueryText(q, signal);

      if (signal.aborted) {
        return { text: results.map((r) => r.responseText).join('\n\n'), costUsd: collected.costUsd, inputTokens: collected.inputTokens, outputTokens: collected.outputTokens, cacheReadTokens: collected.cacheReadTokens, cacheWriteTokens: collected.cacheWriteTokens };
      }

      return { text: collected.text || results.map((r) => r.responseText).join('\n\n'), costUsd: collected.costUsd, inputTokens: collected.inputTokens, outputTokens: collected.outputTokens, cacheReadTokens: collected.cacheReadTokens, cacheWriteTokens: collected.cacheWriteTokens };
    } catch (err) {
      logger.error({ err }, 'Synthesis API call failed');
      // Fallback: concatenate sub-agent results
      return { text: results.map((r) => `## ${r.agentType}\n${r.responseText}`).join('\n\n'), costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    }
  }

  // =========================================================================
  // Shared helpers
  // =========================================================================

  private processMessage(message: SDKMessage, orchestratorId: string, ws: WebSocket, channel?: 'setup' | 'chat' | 'plan'): void {
    switch (message.type) {
      case 'stream_event': {
        const event = (message as any).event;
        if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
          broadcast({
            type: 'chat:token',
            payload: {
              token: event.delta.text,
              agentId: orchestratorId,
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
              agentId: orchestratorId,
              timestamp: Date.now(),
              ...(channel ? { channel } : {}),
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
    return buildAuthEnv();
  }

  /**
   * Iterates over a query() stream, optionally forwarding messages to the UI,
   * and collects all assistant text blocks into a single string along with
   * usage data from the result message.
   */
  private async collectQueryText(
    q: Query,
    signal: AbortSignal,
    agentId?: string,
    ws?: WebSocket,
    channel?: 'setup' | 'chat' | 'plan',
  ): Promise<{ text: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }> {
    let text = '';
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    for await (const message of q) {
      if (signal.aborted) break;
      if (agentId && ws && channel) {
        this.processMessage(message, agentId, ws, channel);
      }
      if (message.type === 'assistant') {
        for (const block of (message as any).message.content) {
          if (block.type === 'text') text += block.text;
        }
      }
      if (message.type === 'result') {
        const result = message as any;
        costUsd = result.total_cost_usd ?? 0;
        inputTokens = result.usage?.input_tokens ?? 0;
        outputTokens = result.usage?.output_tokens ?? 0;
        cacheReadTokens = result.usage?.cache_read_input_tokens ?? 0;
        cacheWriteTokens = result.usage?.cache_creation_input_tokens ?? 0;
      }
    }
    return { text, costUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
  }

  // =========================================================================
  // Plan mode — private implementation
  // =========================================================================

  private async handlePlanMode(content: string, ws: WebSocket, project: Project, model: string): Promise<void> {
    const agentManager = getAgentManager();
    const projectManager = getProjectManager();

    const orchestratorNode = agentManager.createAgent(project.id, 'orchestrator', null, null, model, 'plan');
    this.currentAgentNodeId = orchestratorNode.id;
    this.planAbortController = new AbortController();
    const signal = this.planAbortController.signal;

    try {
      logger.info({ projectId: project.id, planSessionId: this.currentPlanSessionId }, 'Plan mode: generating plan via query()');

      // Gather recent plan conversation scoped to the current plan session
      const recentMessages = this.currentPlanSessionId
        ? projectManager.getRecentPlanMessages(project.id, this.currentPlanSessionId, MAX_ROUTING_HISTORY_MESSAGES)
        : projectManager.getRecentMessages(project.id, MAX_ROUTING_HISTORY_MESSAGES, 'plan');

      // Generate plan via query() SDK call (handles OAuth internally)
      const responseText = await this.generatePlan(content, project, recentMessages, signal as any, ws, model);

      if (signal.aborted) {
        agentManager.updateAgentStatus(orchestratorNode.id, 'interrupted');
        return;
      }

      // Try to extract a plan from the response (populates the dedicated steps UI)
      this.tryExtractPlan(responseText, project);

      // Strip the ```plan``` JSON block from chat — the steps UI already shows it
      const chatText = responseText.replace(/```plan\s*\n[\s\S]*?\n```/g, '').trim();

      // Broadcast the response via plan channel
      if (chatText) {
        broadcast({
          type: 'chat:message',
          payload: {
            role: 'assistant',
            content: chatText,
            agentId: orchestratorNode.id,
            timestamp: Date.now(),
            channel: 'plan',
          },
        });
      }

      agentManager.setAgentResponse(orchestratorNode.id, responseText);
      agentManager.updateAgentStatus(orchestratorNode.id, 'completed', responseText.slice(0, 500));

      // Persist assistant plan message (full text kept for history), scoped to plan session
      projectManager.addMessage(project.id, 'assistant', responseText, orchestratorNode.id, 'plan', this.currentPlanSessionId ?? undefined);

    } catch (err) {
      logger.error({ err }, 'Plan mode error');
      agentManager.updateAgentStatus(orchestratorNode.id, 'failed');
      sendTo(ws, {
        type: 'chat:error',
        payload: { message: err instanceof Error ? err.message : 'Plan query failed', channel: 'plan' },
      });
    } finally {
      this.planAbortController = null;
    }
  }

  private async generatePlan(
    content: string,
    project: Project,
    recentMessages: StoredMessage[],
    signal: AbortSignal,
    ws: WebSocket,
    model: string = 'sonnet',
  ): Promise<string> {
    // Build rich context from project metadata, workspace files, and session summary
    const contextParts: string[] = [];

    // Project knowledge: settings + memory entries (unified & deduplicated)
    try {
      const projectCtx = buildProjectContext(project);
      let memoryEntries: MemoryEntry[] = [];
      try {
        const memoryStore = getMemoryStore();
        const intent = detectTaskIntent(content);
        const results = memoryStore.searchByProjectWithIntent(
          project.workspaceId, project.id, content, intent, MAX_MEMORY_INJECTION_ENTRIES,
        );
        memoryEntries = results.map((r) => r.entry);
      } catch {
        logger.debug('MemoryStore not available for plan context');
      }

      const unified = buildUnifiedKnowledge(projectCtx, memoryEntries, project.metadata, project.updatedAt);
      if (unified) {
        contextParts.push(`## Project Knowledge\n${unified}`);
      }
    } catch {
      // Fallback to basic project context
      const projectContext = buildProjectContext(project);
      if (projectContext) {
        contextParts.push(`## Project Context\n${projectContext}`);
      }
    }

    // Workspace files (PROJECT.md, CONVENTIONS.md)
    try {
      const workspaceFiles = getWorkspaceFiles();
      const wsContext = workspaceFiles.getContext();
      if (wsContext) {
        contextParts.push(`## Workspace Files\n${wsContext}`);
      }
    } catch {
      logger.debug('WorkspaceFiles not available for plan context');
    }

    // Session summary
    try {
      const summaryCache = getSummaryCache();
      const summary = summaryCache.getSummary(project.id);
      if (summary) {
        contextParts.push(`## Session Summary\n${summary}`);
      }
    } catch {
      logger.debug('SummaryCache not available for plan context');
    }

    // Inject existing plan if one was previously generated in this session
    if (this.currentPlan && this.currentPlan.status !== 'cancelled') {
      const planJson = JSON.stringify({
        title: this.currentPlan.title,
        summary: this.currentPlan.summary,
        steps: this.currentPlan.steps.map(s => ({
          id: s.id,
          title: s.title,
          description: s.description,
          agentType: s.agentType,
          estimatedComplexity: s.estimatedComplexity,
          dependencies: s.dependencies,
        })),
      }, null, 2);
      contextParts.push(`## Current Plan\nThe following plan was previously generated in this conversation. Build upon it for any follow-up requests unless the user explicitly asks to start fresh.\n\`\`\`json\n${planJson}\n\`\`\``);
    }

    // Build the user message with inline context
    const contextSection = contextParts.length > 0
      ? contextParts.join('\n\n') + '\n\n'
      : '';

    // Include plan conversation history in the prompt
    const historyText = recentMessages
      .slice(0, -1) // skip the latest user message
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');

    const fullPrompt = historyText
      ? `${historyText}\n\n${contextSection}## User Request\n${content}`
      : `${contextSection}## User Request\n${content}`;

    try {
      const q = query({
        prompt: fullPrompt,
        options: {
          customSystemPrompt: PLAN_SYSTEM_PROMPT,
          permissionMode: 'plan',
          model: resolveModelId(model),
          includePartialMessages: true,
          cwd: project.directoryPath ?? this.config.PROJECT_ROOT,
          env: this.buildEnv(),
          abortController: this.planAbortController ?? undefined,
        },
      });

      const { text: responseText } = await this.collectQueryText(q, signal, this.currentAgentNodeId!, ws, 'plan');

      return responseText || 'I was unable to generate a plan. Could you provide more details about what you want to accomplish?';
    } catch (err) {
      logger.error({ err }, 'Plan generation API call failed');
      throw err;
    }
  }

  private tryExtractPlan(responseText: string, project: Project): void {
    const planMatch = responseText.match(/```plan\s*\n([\s\S]*?)\n```/);
    if (!planMatch) return;

    try {
      const planData = JSON.parse(planMatch[1]);
      const planManager = getPlanManager();

      // Add status: 'pending' to each step if not present
      const steps: PlanStep[] = (planData.steps || []).map((s: any) => ({
        id: s.id || generateId(),
        title: s.title,
        description: s.description,
        agentType: s.agentType,
        status: 'pending' as const,
        dependencies: s.dependencies || [],
        estimatedComplexity: s.estimatedComplexity,
      }));

      let plan: Plan;

      if (this.currentPlan && this.currentPlan.status !== 'cancelled') {
        // Update existing plan rather than creating a new one
        const updates = {
          title: planData.title || this.currentPlan.title,
          summary: planData.summary || this.currentPlan.summary,
          steps,
          status: 'ready' as const,
        };
        planManager.updatePlan(this.currentPlan.id, updates);
        plan = { ...this.currentPlan, ...updates, updatedAt: nowUnix() };
        logger.info({ planId: plan.id, stepCount: plan.steps.length }, 'Plan revised from response');
      } else {
        // First plan in this session — create new record
        plan = planManager.createPlan({
          projectId: project.id,
          title: planData.title || 'Untitled Plan',
          summary: planData.summary || '',
          steps,
          status: 'ready',
          planSessionId: this.currentPlanSessionId,
        });
        logger.info({ planId: plan.id, stepCount: plan.steps.length }, 'Plan extracted from response');
      }

      this.currentPlan = plan;
      broadcast({ type: 'plan:updated', payload: plan });

      // Notify the user the plan is ready for review
      broadcast({
        type: 'chat:message',
        payload: {
          role: 'assistant',
          content: `Plan "${plan.title}" is ready with ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}. You can approve & execute it, save it for later, or ask me to revise it.`,
          agentId: 'system',
          timestamp: Date.now(),
          channel: 'plan',
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to parse plan from response');
    }
  }

  private async executePlan(plan: Plan, ws: WebSocket): Promise<void> {
    if (!this.currentProject) {
      sendTo(ws, { type: 'chat:error', payload: { message: 'No active project' } });
      return;
    }

    const project = this.currentProject;
    const planManager = getPlanManager();

    // Set plan status to executing
    plan.status = 'executing';
    planManager.updatePlan(plan.id, { status: 'executing' });
    broadcast({ type: 'plan:updated', payload: plan });
    broadcast({ type: 'plan:execution_started', payload: { planId: plan.id } });

    // Exit plan mode
    this.setPlanMode(false);

    try {
      // If workflow metadata exists, delegate to WorkflowExecutor
      if (plan.workflowMetadata) {
        const cwd = project.directoryPath ?? this.config.PROJECT_ROOT;
        const executor = new WorkflowExecutor();
        await executor.execute(plan, project, ws, {
          cwd,
          model: this.currentModel,
          handleNormalMode: (content, wsRef, proj, model) =>
            this.handleNormalMode(content, wsRef, proj, model, 'plan'),
        });
        return;
      }

      // Legacy sequential execution path
      const executionOrder = this.buildExecutionOrder(plan.steps);
      let allSucceeded = true;

      for (const step of executionOrder) {
        step.status = 'in_progress';
        planManager.updatePlanStep(plan.id, step);
        broadcast({ type: 'plan:step_updated', payload: { planId: plan.id, step } });

        try {
          await this.handleNormalMode(
            `[Plan Step ${step.id}] ${step.title}\n\n${step.description}`,
            ws,
            project,
            this.currentModel,
            'plan',
          );

          step.status = 'completed';
        } catch (err) {
          logger.error({ err, stepId: step.id }, 'Plan step execution failed');
          step.status = 'failed';
          allSucceeded = false;
        }

        planManager.updatePlanStep(plan.id, step);
        broadcast({ type: 'plan:step_updated', payload: { planId: plan.id, step } });

        if (step.status === 'failed') {
          break;
        }
      }

      const finalStatus = allSucceeded ? 'completed' : 'failed';
      plan.status = finalStatus;
      planManager.updatePlan(plan.id, { status: finalStatus });
      broadcast({ type: 'plan:updated', payload: plan });
    } catch (err) {
      logger.error({ err, planId: plan.id }, 'Plan execution failed');
      plan.status = 'failed';
      planManager.updatePlan(plan.id, { status: 'failed' });
      broadcast({ type: 'plan:updated', payload: plan });
    } finally {
      // Always signal completion if still marked executing
      if (plan.status === 'executing') {
        plan.status = 'failed';
        planManager.updatePlan(plan.id, { status: 'failed' });
        broadcast({ type: 'plan:updated', payload: plan });
      }
      broadcast({ type: 'plan:execution_completed', payload: { planId: plan.id, status: plan.status } });
    }
  }

  private buildExecutionOrder(steps: PlanStep[]): PlanStep[] {
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const ordered: PlanStep[] = [];

    const visit = (step: PlanStep) => {
      if (visited.has(step.id)) return;
      visited.add(step.id);
      for (const depId of step.dependencies ?? []) {
        const dep = stepMap.get(depId);
        if (dep) visit(dep);
      }
      ordered.push(step);
    };

    for (const step of steps) {
      visit(step);
    }

    return ordered;
  }

  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info('Query interrupted');
    }
  }

  interruptAgent(agentId: string): boolean {
    const controller = this.subAgentAbortControllers.get(agentId);
    if (controller) {
      controller.abort();
      this.subAgentAbortControllers.delete(agentId);
      // Immediately update status — don't rely on the iterator
      const agentManager = getAgentManager();
      agentManager.updateAgentStatus(agentId, 'interrupted');
      logger.info({ agentId }, 'Individual agent interrupted');
      return true;
    }

    // No active controller — process already finished or was cleaned up.
    // Re-broadcast agent status to resync the UI.
    const agentManager = getAgentManager();
    const agent = agentManager.getAgent(agentId);
    if (agent) {
      if (agent.status === 'running') {
        agentManager.updateAgentStatus(agentId, 'interrupted');
      } else {
        // Agent already finished — re-broadcast current status to fix UI desync
        broadcast({ type: 'agent:stopped', payload: agent });
      }
      logger.info({ agentId, status: agent.status }, 'Agent interrupt handled (no active controller)');
      return true;
    }

    // Agent not in memory — may be a stale agent loaded from DB (e.g. after server restart).
    // Fall back to direct DB update so the stop button actually works.
    try {
      const db = getDb();
      const row = db.prepare(
        `SELECT id, project_id, agent_type, status, parent_agent_id, task_description, result_summary,
                cost_usd, tokens, duration_ms, started_at, completed_at, model, response_text
         FROM agent_runs WHERE id = ?`
      ).get(agentId) as any;

      if (row) {
        const now = nowUnix();
        if (row.status === 'running') {
          db.prepare(
            `UPDATE agent_runs SET status = 'interrupted', completed_at = ?, duration_ms = ? WHERE id = ?`
          ).run(now, row.started_at ? (now - row.started_at) * 1000 : null, agentId);
        }

        const stoppedAgent: AgentNode = {
          id: row.id,
          projectId: row.project_id,
          type: row.agent_type,
          status: 'interrupted',
          parentAgentId: row.parent_agent_id ?? null,
          taskDescription: row.task_description ?? null,
          resultSummary: row.result_summary ?? null,
          costUsd: row.cost_usd ?? 0,
          tokens: row.tokens ?? 0,
          durationMs: row.started_at ? (now - row.started_at) * 1000 : null,
          startedAt: row.started_at,
          completedAt: now,
          model: row.model ?? null,
          responseText: row.response_text ?? null,
        };
        broadcast({ type: 'agent:stopped', payload: stoppedAgent });

        logger.info({ agentId, previousStatus: row.status }, 'Stale agent interrupted via DB fallback');
        return true;
      }
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to interrupt stale agent via DB');
    }

    return false;
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
