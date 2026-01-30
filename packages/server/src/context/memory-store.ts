import type { MemoryEntry, MemoryCategory, MemoryScope, MemorySearchResult, CreateMemoryInput, UpdateMemoryInput } from '@cloudscode/shared';
import { generateId, nowUnix } from '@cloudscode/shared';
import { getDb } from '../db/database.js';
import { logger } from '../logger.js';

class MemoryStore {
  create(workspaceId: string, input: CreateMemoryInput, sourceProjectId?: string): MemoryEntry {
    const db = getDb();
    const scope: MemoryScope = input.scope ?? 'workspace';
    const entry: MemoryEntry = {
      id: generateId(),
      workspaceId,
      category: input.category,
      key: input.key,
      content: input.content,
      sourceProjectId: sourceProjectId ?? null,
      scope,
      confidence: 1.0,
      useCount: 0,
      createdAt: nowUnix(),
      updatedAt: nowUnix(),
    };

    db.prepare(`
      INSERT INTO memory_entries (id, workspace_id, category, key, content, source_project_id, scope, confidence, use_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.workspaceId, entry.category, entry.key,
      entry.content, entry.sourceProjectId, entry.scope, entry.confidence,
      entry.useCount, entry.createdAt, entry.updatedAt,
    );

    logger.info({ id: entry.id, category: entry.category, key: entry.key, scope: entry.scope }, 'Memory entry created');
    return entry;
  }

  get(id: string): MemoryEntry | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id) as any;
    return row ? this.rowToEntry(row) : null;
  }

  update(id: string, input: UpdateMemoryInput): MemoryEntry | null {
    const db = getDb();
    const sets: string[] = ['updated_at = ?'];
    const values: any[] = [nowUnix()];

    if (input.category !== undefined) {
      sets.push('category = ?');
      values.push(input.category);
    }
    if (input.key !== undefined) {
      sets.push('key = ?');
      values.push(input.key);
    }
    if (input.content !== undefined) {
      sets.push('content = ?');
      values.push(input.content);
    }
    if (input.confidence !== undefined) {
      sets.push('confidence = ?');
      values.push(input.confidence);
    }
    if (input.scope !== undefined) {
      sets.push('scope = ?');
      values.push(input.scope);
    }

    values.push(id);
    db.prepare(`UPDATE memory_entries SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.get(id);
  }

  delete(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id);
    return result.changes > 0;
  }

  listByWorkspace(workspaceId: string, category?: MemoryCategory): MemoryEntry[] {
    const db = getDb();
    if (category) {
      return (db.prepare(
        'SELECT * FROM memory_entries WHERE workspace_id = ? AND category = ? ORDER BY updated_at DESC',
      ).all(workspaceId, category) as any[]).map(this.rowToEntry);
    }
    return (db.prepare(
      'SELECT * FROM memory_entries WHERE workspace_id = ? ORDER BY updated_at DESC',
    ).all(workspaceId) as any[]).map(this.rowToEntry);
  }

  listByProject(workspaceId: string, projectId: string, category?: MemoryCategory): MemoryEntry[] {
    const db = getDb();
    if (category) {
      return (db.prepare(
        `SELECT * FROM memory_entries
         WHERE workspace_id = ? AND category = ?
           AND (scope = 'workspace' OR (scope = 'project' AND source_project_id = ?))
         ORDER BY updated_at DESC`,
      ).all(workspaceId, category, projectId) as any[]).map(this.rowToEntry);
    }
    return (db.prepare(
      `SELECT * FROM memory_entries
       WHERE workspace_id = ?
         AND (scope = 'workspace' OR (scope = 'project' AND source_project_id = ?))
       ORDER BY updated_at DESC`,
    ).all(workspaceId, projectId) as any[]).map(this.rowToEntry);
  }

  search(workspaceId: string, queryText: string, limit: number = 10): MemorySearchResult[] {
    const db = getDb();

    // Sanitize query for FTS5: strip special characters and quote each token
    const sanitized = queryText
      .replace(/[?*+\-"(){}[\]^~:\\/<>!@#$%&=|;,]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t}"`)
      .join(' OR ');

    if (!sanitized) {
      return [];
    }

    // FTS5 search
    const rows = db.prepare(`
      SELECT me.*, rank
      FROM memory_fts
      JOIN memory_entries me ON memory_fts.rowid = me.rowid
      WHERE memory_fts MATCH ? AND me.workspace_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, workspaceId, limit) as any[];

    // Increment use counts
    for (const row of rows) {
      db.prepare('UPDATE memory_entries SET use_count = use_count + 1 WHERE id = ?').run(row.id);
    }

    return rows.map((row) => ({
      entry: this.rowToEntry(row),
      rank: row.rank,
    }));
  }

  searchByProject(workspaceId: string, projectId: string, queryText: string, limit: number = 10): MemorySearchResult[] {
    const db = getDb();

    const sanitized = queryText
      .replace(/[?*+\-"(){}[\]^~:\\/<>!@#$%&=|;,]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t}"`)
      .join(' OR ');

    if (!sanitized) {
      return [];
    }

    const rows = db.prepare(`
      SELECT me.*, rank
      FROM memory_fts
      JOIN memory_entries me ON memory_fts.rowid = me.rowid
      WHERE memory_fts MATCH ? AND me.workspace_id = ?
        AND (me.scope = 'workspace' OR (me.scope = 'project' AND me.source_project_id = ?))
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, workspaceId, projectId, limit) as any[];

    for (const row of rows) {
      db.prepare('UPDATE memory_entries SET use_count = use_count + 1 WHERE id = ?').run(row.id);
    }

    return rows.map((row) => ({
      entry: this.rowToEntry(row),
      rank: row.rank,
    }));
  }

  formatForContext(entries: MemoryEntry[]): string {
    if (entries.length === 0) return '';

    const grouped = new Map<string, MemoryEntry[]>();
    for (const entry of entries) {
      const group = grouped.get(entry.category) ?? [];
      group.push(entry);
      grouped.set(entry.category, group);
    }

    const parts: string[] = [];
    for (const [category, items] of grouped) {
      parts.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      for (const item of items) {
        parts.push(`- **${item.key}**: ${item.content}`);
      }
    }

    return parts.join('\n');
  }

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      category: row.category as MemoryCategory,
      key: row.key,
      content: row.content,
      sourceProjectId: row.source_project_id,
      scope: (row.scope ?? 'workspace') as MemoryScope,
      confidence: row.confidence,
      useCount: row.use_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let memoryStore: MemoryStore;

export function initMemoryStore(): MemoryStore {
  memoryStore = new MemoryStore();
  return memoryStore;
}

export function getMemoryStore(): MemoryStore {
  if (!memoryStore) {
    throw new Error('MemoryStore not initialized');
  }
  return memoryStore;
}
