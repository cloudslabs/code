import type { TokenUsageHistoryResponse, TokenUsageBucket, UsageGranularity } from '@cloudscode/shared';
import { generateId, nowUnix } from '@cloudscode/shared';
import { getDb } from './database.js';
import { logger } from '../logger.js';

interface RecordInput {
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  agentRunId?: string;
  agentType?: string;
}

class TokenUsageStore {
  record(data: RecordInput): void {
    try {
      const db = getDb();
      const id = generateId();
      const totalTokens = data.inputTokens + data.outputTokens;
      db.prepare(`
        INSERT INTO token_usage (id, project_id, agent_run_id, agent_type, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_usd, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.projectId,
        data.agentRunId ?? null,
        data.agentType ?? null,
        data.inputTokens,
        data.outputTokens,
        data.cacheReadTokens,
        data.cacheWriteTokens,
        totalTokens,
        data.costUsd,
        nowUnix(),
      );
    } catch (err) {
      logger.error({ err }, 'Failed to record token usage');
    }
  }

  getHistory(projectId: string, granularity: UsageGranularity, from?: number, to?: number): TokenUsageHistoryResponse {
    const db = getDb();

    let bucketExpr: string;
    switch (granularity) {
      case 'daily':
        bucketExpr = '(recorded_at / 86400) * 86400';
        break;
      case 'weekly':
        bucketExpr = '((recorded_at / 604800)) * 604800';
        break;
      case 'monthly':
        bucketExpr = "CAST(strftime('%s', strftime('%Y-%m-01', recorded_at, 'unixepoch')) AS INTEGER)";
        break;
      default:
        bucketExpr = '(recorded_at / 86400) * 86400';
    }

    const conditions = ['project_id = ?'];
    const params: (string | number)[] = [projectId];

    if (from !== undefined) {
      conditions.push('recorded_at >= ?');
      params.push(from);
    }
    if (to !== undefined) {
      conditions.push('recorded_at <= ?');
      params.push(to);
    }

    const whereClause = conditions.join(' AND ');

    const buckets = db.prepare(`
      SELECT
        ${bucketExpr} AS period_start,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(cost_usd) AS cost_usd,
        COUNT(*) AS record_count
      FROM token_usage
      WHERE ${whereClause}
      GROUP BY ${bucketExpr}
      ORDER BY period_start ASC
    `).all(...params) as any[];

    const mappedBuckets: TokenUsageBucket[] = buckets.map((row) => ({
      periodStart: row.period_start,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      totalTokens: row.total_tokens,
      costUsd: row.cost_usd,
      recordCount: row.record_count,
    }));

    const totals = this.getTotals(projectId, from, to);

    return {
      projectId,
      granularity,
      buckets: mappedBuckets,
      totals,
    };
  }

  getTotals(projectId: string, from?: number, to?: number): TokenUsageHistoryResponse['totals'] {
    const db = getDb();

    const conditions = ['project_id = ?'];
    const params: (string | number)[] = [projectId];

    if (from !== undefined) {
      conditions.push('recorded_at >= ?');
      params.push(from);
    }
    if (to !== undefined) {
      conditions.push('recorded_at <= ?');
      params.push(to);
    }

    const whereClause = conditions.join(' AND ');

    const row = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(cost_usd), 0) AS cost_usd,
        COUNT(*) AS record_count
      FROM token_usage
      WHERE ${whereClause}
    `).get(...params) as any;

    return {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      totalTokens: row.total_tokens,
      costUsd: row.cost_usd,
      recordCount: row.record_count,
    };
  }

  deleteByProject(projectId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM token_usage WHERE project_id = ?').run(projectId);
  }
}

let tokenUsageStore: TokenUsageStore;

export function initTokenUsageStore(): TokenUsageStore {
  tokenUsageStore = new TokenUsageStore();
  return tokenUsageStore;
}

export function getTokenUsageStore(): TokenUsageStore {
  if (!tokenUsageStore) {
    throw new Error('TokenUsageStore not initialized');
  }
  return tokenUsageStore;
}
