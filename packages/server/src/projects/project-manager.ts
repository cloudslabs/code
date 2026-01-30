import type { Project, ProjectListItem, ProjectMetadata, ProjectMetadataCategory, StoredMessage } from '@cloudscode/shared';
import { ProjectStore } from './project-store.js';
import { getDb } from '../db/database.js';
import { generateId } from '@cloudscode/shared';
import { logger } from '../logger.js';

class ProjectManager {
  private store: ProjectStore;
  private defaultWorkspaceId: string | null = null;

  constructor() {
    this.store = new ProjectStore();
  }

  ensureWorkspace(name: string, rootPath: string): string {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM workspaces WHERE root_path = ?').get(rootPath) as any;
    if (existing) {
      this.defaultWorkspaceId = existing.id;
      return existing.id;
    }

    const id = generateId();
    db.prepare('INSERT INTO workspaces (id, name, root_path) VALUES (?, ?, ?)').run(id, name, rootPath);
    this.defaultWorkspaceId = id;
    logger.info({ workspaceId: id, name, rootPath }, 'Workspace created');
    return id;
  }

  getDefaultWorkspaceId(): string | null {
    return this.defaultWorkspaceId;
  }

  createProject(workspaceId: string, title?: string, opts?: { directoryPath?: string; setupCompleted?: boolean }): Project {
    const project = this.store.createProject(workspaceId, title, opts);
    logger.info({ projectId: project.id, workspaceId, setupCompleted: project.setupCompleted }, 'Project created');
    return project;
  }

  getProject(id: string): Project | null {
    return this.store.getProject(id);
  }

  listProjects(workspaceId: string): ProjectListItem[] {
    return this.store.listProjects(workspaceId);
  }

  updateProject(id: string, updates: Partial<Pick<Project, 'title' | 'summary' | 'status' | 'totalCostUsd' | 'totalTokens' | 'description' | 'purpose' | 'repositoryUrl' | 'primaryLanguage' | 'architecturePattern' | 'directoryPath'>>): void {
    this.store.updateProject(id, updates);
  }

  deleteProject(id: string): void {
    this.store.deleteProject(id);
    logger.info({ projectId: id }, 'Project deleted');
  }

  getSdkSessionId(projectId: string): string | null {
    return this.store.getSdkSessionId(projectId);
  }

  setSdkSessionId(projectId: string, sdkSessionId: string): void {
    this.store.setSdkSessionId(projectId, sdkSessionId);
  }

  getProjectMetadata(projectId: string, category?: ProjectMetadataCategory): ProjectMetadata | unknown {
    const metadata = this.store.getMetadata(projectId);
    if (category) {
      return metadata[category];
    }
    return metadata;
  }

  updateProjectMetadata(projectId: string, category: ProjectMetadataCategory, data: unknown): void {
    this.store.updateMetadata(projectId, category, data);
    logger.info({ projectId, category }, 'Project metadata updated');
  }

  setFullMetadata(projectId: string, metadata: ProjectMetadata): void {
    this.store.setFullMetadata(projectId, metadata);
    logger.info({ projectId }, 'Project full metadata set');
  }

  setDirectoryPath(projectId: string, dirPath: string): void {
    this.store.setDirectoryPath(projectId, dirPath);
    logger.info({ projectId, dirPath }, 'Project directory path set');
  }

  markSetupCompleted(projectId: string): void {
    this.store.markSetupCompleted(projectId);
    logger.info({ projectId }, 'Project setup completed');
  }

  addMessage(projectId: string, role: string, content: string, agentId?: string, channel?: 'chat' | 'setup' | 'plan'): StoredMessage {
    return this.store.addMessage(projectId, role, content, agentId, channel);
  }

  getMessages(projectId: string, channel?: 'chat' | 'setup' | 'plan'): StoredMessage[] {
    return this.store.getMessages(projectId, channel);
  }

  getRecentMessages(projectId: string, limit?: number, channel?: 'chat' | 'setup' | 'plan'): StoredMessage[] {
    return this.store.getRecentMessages(projectId, limit, channel);
  }

  getPlanMessages(projectId: string): StoredMessage[] {
    return this.store.getPlanMessages(projectId);
  }
}

let projectManager: ProjectManager;

export function initProjectManager(): ProjectManager {
  projectManager = new ProjectManager();
  return projectManager;
}

export function getProjectManager(): ProjectManager {
  if (!projectManager) {
    throw new Error('ProjectManager not initialized');
  }
  return projectManager;
}
