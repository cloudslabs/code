export interface ContextBudget {
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  maxBudgetUsd: number | null;
  agentBreakdown: AgentTokenUsage[];
}

export interface AgentTokenUsage {
  agentId: string;
  agentType: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface TokenUsageUpdate {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface TokenUsageRecord {
  id: string;
  projectId: string;
  agentRunId: string | null;
  agentType: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  recordedAt: number;
}

export type UsageGranularity = 'daily' | 'weekly' | 'monthly';

export interface TokenUsageBucket {
  periodStart: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  recordCount: number;
}

export interface TokenUsageHistoryResponse {
  projectId: string;
  granularity: UsageGranularity;
  buckets: TokenUsageBucket[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    costUsd: number;
    recordCount: number;
  };
}
