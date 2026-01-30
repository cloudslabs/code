import type { Project, ProjectListItem, ProjectStatus, ProjectMetadata, ProjectMetadataCategory, StoredMessage } from '@cloudscode/shared';
import { getDb } from '../db/database.js';
import { generateId, nowUnix } from '@cloudscode/shared';

export class ProjectStore {
  createProject(workspaceId: string, title?: string, opts?: { directoryPath?: string; setupCompleted?: boolean }): Project {
    const db = getDb();
    const project: Project = {
      id: generateId(),
      workspaceId,
      title: title ?? null,
      summary: null,
      status: 'active',
      totalCostUsd: 0,
      totalTokens: 0,
      sdkSessionId: null,
      createdAt: nowUnix(),
      updatedAt: nowUnix(),
      description: null,
      purpose: null,
      repositoryUrl: null,
      primaryLanguage: null,
      architecturePattern: null,
      metadata: {},
      directoryPath: opts?.directoryPath ?? null,
      setupCompleted: opts?.setupCompleted ?? true,
    };

    db.prepare(`
      INSERT INTO projects (id, workspace_id, title, summary, status, total_cost_usd, total_tokens, created_at, updated_at, metadata, directory_path, setup_completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id,
      project.workspaceId,
      project.title,
      project.summary ? JSON.stringify(project.summary) : null,
      project.status,
      project.totalCostUsd,
      project.totalTokens,
      project.createdAt,
      project.updatedAt,
      JSON.stringify(project.metadata),
      project.directoryPath,
      project.setupCompleted ? 1 : 0,
    );

    return project;
  }

  getProject(id: string): Project | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToProject(row);
  }

  listProjects(workspaceId: string): ProjectListItem[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, title, status, total_cost_usd, updated_at, description, primary_language, setup_completed FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC',
    ).all(workspaceId) as any[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as ProjectStatus,
      totalCostUsd: row.total_cost_usd,
      updatedAt: row.updated_at,
      description: row.description,
      primaryLanguage: row.primary_language,
      setupCompleted: row.setup_completed === 1,
    }));
  }

  updateProject(id: string, updates: Partial<Pick<Project, 'title' | 'summary' | 'status' | 'totalCostUsd' | 'totalTokens' | 'description' | 'purpose' | 'repositoryUrl' | 'primaryLanguage' | 'architecturePattern' | 'directoryPath'>>): void {
    const db = getDb();
    const sets: string[] = ['updated_at = ?'];
    const values: any[] = [nowUnix()];

    if (updates.title !== undefined) {
      sets.push('title = ?');
      values.push(updates.title);
    }
    if (updates.summary !== undefined) {
      sets.push('summary = ?');
      values.push(updates.summary ? JSON.stringify(updates.summary) : null);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.totalCostUsd !== undefined) {
      sets.push('total_cost_usd = ?');
      values.push(updates.totalCostUsd);
    }
    if (updates.totalTokens !== undefined) {
      sets.push('total_tokens = ?');
      values.push(updates.totalTokens);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      values.push(updates.description);
    }
    if (updates.purpose !== undefined) {
      sets.push('purpose = ?');
      values.push(updates.purpose);
    }
    if (updates.repositoryUrl !== undefined) {
      sets.push('repository_url = ?');
      values.push(updates.repositoryUrl);
    }
    if (updates.primaryLanguage !== undefined) {
      sets.push('primary_language = ?');
      values.push(updates.primaryLanguage);
    }
    if (updates.architecturePattern !== undefined) {
      sets.push('architecture_pattern = ?');
      values.push(updates.architecturePattern);
    }
    if (updates.directoryPath !== undefined) {
      sets.push('directory_path = ?');
      values.push(updates.directoryPath);
    }

    values.push(id);
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteProject(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM agent_runs WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  getSdkSessionId(projectId: string): string | null {
    const db = getDb();
    const row = db.prepare('SELECT sdk_session_id FROM projects WHERE id = ?').get(projectId) as any;
    return row?.sdk_session_id ?? null;
  }

  setSdkSessionId(projectId: string, sdkSessionId: string): void {
    const db = getDb();
    db.prepare('UPDATE projects SET sdk_session_id = ? WHERE id = ?').run(sdkSessionId, projectId);
  }

  getMetadata(projectId: string): ProjectMetadata {
    const db = getDb();
    const row = db.prepare('SELECT metadata FROM projects WHERE id = ?').get(projectId) as any;
    if (!row?.metadata) return {};
    try {
      return JSON.parse(row.metadata);
    } catch {
      return {};
    }
  }

  updateMetadata(projectId: string, category: ProjectMetadataCategory, data: unknown): void {
    const db = getDb();
    const current = this.getMetadata(projectId);
    (current as any)[category] = data;
    db.prepare('UPDATE projects SET metadata = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(current),
      nowUnix(),
      projectId,
    );
  }

  setFullMetadata(projectId: string, metadata: ProjectMetadata): void {
    const db = getDb();
    db.prepare('UPDATE projects SET metadata = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(metadata),
      nowUnix(),
      projectId,
    );
  }

  addMessage(projectId: string, role: string, content: string, agentId?: string, channel?: 'chat' | 'setup' | 'plan'): StoredMessage {
    const db = getDb();
    const msg: StoredMessage = {
      id: generateId(),
      projectId,
      role: role as 'user' | 'assistant',
      content,
      agentId: agentId ?? null,
      channel: channel ?? 'chat',
      createdAt: nowUnix(),
    };
    db.prepare(
      'INSERT INTO messages (id, project_id, role, content, agent_id, channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(msg.id, msg.projectId, msg.role, msg.content, msg.agentId, msg.channel, msg.createdAt);
    return msg;
  }

  getMessages(projectId: string, channel?: 'chat' | 'setup' | 'plan'): StoredMessage[] {
    const db = getDb();
    const ch = channel ?? 'chat';
    const rows = db.prepare(
      'SELECT * FROM messages WHERE project_id = ? AND (channel = ? OR channel IS NULL) ORDER BY created_at ASC',
    ).all(projectId, ch) as any[];
    return rows.map((r) => this.rowToMessage(r));
  }

  getRecentMessages(projectId: string, limit: number = 20, channel?: 'chat' | 'setup' | 'plan'): StoredMessage[] {
    const db = getDb();
    const ch = channel ?? 'chat';
    const rows = db.prepare(
      'SELECT * FROM messages WHERE project_id = ? AND (channel = ? OR channel IS NULL) ORDER BY created_at DESC LIMIT ?',
    ).all(projectId, ch, limit) as any[];
    return rows.reverse().map((r) => this.rowToMessage(r));
  }

  getPlanMessages(projectId: string): StoredMessage[] {
    return this.getMessages(projectId, 'plan');
  }

  private rowToMessage(r: any): StoredMessage {
    return {
      id: r.id,
      projectId: r.project_id,
      role: r.role,
      content: r.content,
      agentId: r.agent_id,
      channel: r.channel ?? 'chat',
      createdAt: r.created_at,
    };
  }

  setDirectoryPath(projectId: string, dirPath: string): void {
    const db = getDb();
    db.prepare('UPDATE projects SET directory_path = ?, updated_at = ? WHERE id = ?').run(dirPath, nowUnix(), projectId);
  }

  markSetupCompleted(projectId: string): void {
    const db = getDb();
    db.prepare('UPDATE projects SET setup_completed = 1, updated_at = ? WHERE id = ?').run(nowUnix(), projectId);
  }

  private rowToProject(row: any): Project {
    let metadata: ProjectMetadata = {};
    try {
      metadata = row.metadata ? JSON.parse(row.metadata) : {};
    } catch {
      metadata = {};
    }

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      summary: row.summary ? JSON.parse(row.summary) : null,
      status: row.status as ProjectStatus,
      totalCostUsd: row.total_cost_usd,
      totalTokens: row.total_tokens,
      sdkSessionId: row.sdk_session_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      description: row.description ?? null,
      purpose: row.purpose ?? null,
      repositoryUrl: row.repository_url ?? null,
      primaryLanguage: row.primary_language ?? null,
      architecturePattern: row.architecture_pattern ?? null,
      metadata,
      directoryPath: row.directory_path ?? null,
      setupCompleted: row.setup_completed === 1,
    };
  }
}
