import type { ProjectMetadataCategory, TokenUsageHistoryResponse, UsageGranularity } from '@cloudscode/shared';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Workspace
  getWorkspace: () => request<{ workspaceId: string }>('/workspace'),
  // Backward compat
  getProject: () => request<{ projectId: string }>('/project'),

  // Projects
  listProjects: (workspaceId: string) =>
    request<{ projects: any[] }>(`/projects?workspaceId=${workspaceId}`),
  getProject_: (id: string) => request<any>(`/projects/${id}`),
  createProject: (workspaceId: string, title?: string) =>
    request<any>('/projects', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, title }),
    }),
  updateProject: (id: string, data: Record<string, unknown>) =>
    request<any>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  updateProjectMetadata: (id: string, category: ProjectMetadataCategory, data: unknown) =>
    request<any>(`/projects/${id}/metadata/${category}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) =>
    request<any>(`/projects/${id}`, { method: 'DELETE' }),
  scanProject: (id: string, category?: string) => {
    const path = category ? `/projects/${id}/scan/${category}` : `/projects/${id}/scan`;
    return request<any>(path, { method: 'POST' });
  },

  // Memory
  listMemory: (workspaceId: string, category?: string, scopeProjectId?: string) => {
    let url = `/memory?workspaceId=${workspaceId}`;
    if (category) url += `&category=${category}`;
    if (scopeProjectId) url += `&scopeProjectId=${scopeProjectId}`;
    return request<{ entries: any[] }>(url);
  },
  searchMemory: (workspaceId: string, q: string, scopeProjectId?: string) => {
    let url = `/memory/search?workspaceId=${workspaceId}&q=${encodeURIComponent(q)}`;
    if (scopeProjectId) url += `&scopeProjectId=${scopeProjectId}`;
    return request<{ results: any[] }>(url);
  },
  createMemory: (data: { workspaceId: string; category: string; key: string; content: string; scope?: string }) =>
    request<any>('/memory', { method: 'POST', body: JSON.stringify(data) }),
  updateMemory: (id: string, data: Record<string, unknown>) =>
    request<any>(`/memory/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMemory: (id: string) =>
    request<any>(`/memory/${id}`, { method: 'DELETE' }),

  // Promotion
  previewPromotion: (memoryId: string, projectId: string) =>
    request<any>(`/promotion/${memoryId}/promote`, {
      method: 'POST',
      body: JSON.stringify({ projectId, preview: true }),
    }),
  promoteMemory: (memoryId: string, projectId: string) =>
    request<any>(`/promotion/${memoryId}/promote`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  getPromotionSuggestions: (workspaceId: string, projectId?: string) => {
    let url = `/promotion/suggestions?workspaceId=${workspaceId}`;
    if (projectId) url += `&projectId=${projectId}`;
    return request<{ suggestions: any[] }>(url);
  },

  // Context
  getContext: (projectId: string) => request<any>(`/context/${projectId}`),

  // Agents
  getAgents: (projectId: string) => request<any>(`/agents/${projectId}`),

  // Workspace files
  getProjectMd: () => request<{ content: string | null }>('/workspace/project'),
  saveProjectMd: (content: string) =>
    request<any>('/workspace/project', { method: 'PUT', body: JSON.stringify({ content }) }),

  // Auth
  getAuthStatus: () =>
    request<{
      authenticated: boolean;
      authType: 'oauth' | 'api_key' | 'none';
      subscriptionType: string | null;
      expiresAt: number | null;
    }>('/settings/auth/status'),
  login: () =>
    request<{ started: boolean; reason?: string }>('/settings/auth/login', { method: 'POST' }),
  logout: () =>
    request<{
      cleared: boolean;
      authenticated: boolean;
      authType: 'oauth' | 'api_key' | 'none';
    }>('/settings/auth/logout', { method: 'POST' }),

  // Plans
  listPlans: (projectId: string) =>
    request<{ plans: any[] }>(`/plans?projectId=${projectId}`),
  getPlan: (id: string) => request<any>(`/plans/${id}`),
  deletePlan: (id: string) =>
    request<any>(`/plans/${id}`, { method: 'DELETE' }),

  // Workflows
  listWorkflowTemplates: (projectId: string) =>
    request<{ templates: any[] }>(`/workflows/templates?projectId=${projectId}`),
  getWorkflowTemplate: (id: string) => request<any>(`/workflows/templates/${id}`),
  createWorkflowTemplate: (projectId: string, input: { name: string; description: string; category: string; steps: any[] }) =>
    request<any>('/workflows/templates', {
      method: 'POST',
      body: JSON.stringify({ projectId, ...input }),
    }),
  updateWorkflowTemplate: (id: string, input: Partial<{ name: string; description: string; category: string; steps: any[] }>) =>
    request<any>(`/workflows/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteWorkflowTemplate: (id: string) =>
    request<any>(`/workflows/templates/${id}`, { method: 'DELETE' }),
  createWorkflowPlan: (projectId: string, templateId: string, userMessage: string, customTitle?: string) =>
    request<any>('/workflows/create', {
      method: 'POST',
      body: JSON.stringify({ projectId, templateId, userMessage, customTitle }),
    }),

  // Projects root directory
  getProjectsRootDir: () =>
    request<{ projectsRootDir: string | null }>('/settings/projects-root'),
  setProjectsRootDir: (rootDir: string) =>
    request<{ ok: boolean }>('/settings/projects-root', {
      method: 'PUT',
      body: JSON.stringify({ rootDir }),
    }),

  // Token Usage History
  getTokenUsageHistory: (projectId: string, granularity: UsageGranularity = 'daily', from?: number, to?: number) => {
    let url = `/token-usage/${projectId}/history?granularity=${granularity}`;
    if (from !== undefined) url += `&from=${from}`;
    if (to !== undefined) url += `&to=${to}`;
    return request<TokenUsageHistoryResponse>(url);
  },
  getTokenUsageSummary: (projectId: string, from?: number, to?: number) => {
    let url = `/token-usage/${projectId}/summary`;
    const params: string[] = [];
    if (from !== undefined) params.push(`from=${from}`);
    if (to !== undefined) params.push(`to=${to}`);
    if (params.length > 0) url += `?${params.join('&')}`;
    return request<{ projectId: string; totals: TokenUsageHistoryResponse['totals'] }>(url);
  },
};
