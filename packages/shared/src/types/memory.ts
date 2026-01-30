export type MemoryCategory = 'architecture' | 'convention' | 'decision' | 'fact' | 'issue';

export type MemoryScope = 'project' | 'workspace';

export interface MemoryEntry {
  id: string;
  workspaceId: string;
  category: MemoryCategory;
  key: string;
  content: string;
  sourceProjectId: string | null;
  scope: MemoryScope;
  confidence: number;
  useCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  rank: number;
}

export interface CreateMemoryInput {
  category: MemoryCategory;
  key: string;
  content: string;
  scope?: MemoryScope;
}

export interface UpdateMemoryInput {
  category?: MemoryCategory;
  key?: string;
  content?: string;
  confidence?: number;
  scope?: MemoryScope;
}
