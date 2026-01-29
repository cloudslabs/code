import { create } from 'zustand';
import type { Project, ProjectListItem, ProjectMetadata } from '@cloudscode/shared';

interface ProjectState {
  projects: ProjectListItem[];
  activeProject: Project | null;
  workspaceId: string | null;

  setProjects: (projects: ProjectListItem[]) => void;
  setActiveProject: (project: Project | null) => void;
  setWorkspaceId: (workspaceId: string) => void;
  addProject: (project: ProjectListItem) => void;
  removeProject: (id: string) => void;
  updateProjectMetadata: (projectId: string, metadata: ProjectMetadata) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProject: null,
  workspaceId: null,

  setProjects: (projects) => set({ projects }),
  setActiveProject: (project) => set({ activeProject: project }),
  setWorkspaceId: (workspaceId) => set({ workspaceId }),

  addProject: (project) =>
    set((state) => ({
      projects: [project, ...state.projects],
    })),

  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProject: state.activeProject?.id === id ? null : state.activeProject,
    })),

  updateProjectMetadata: (projectId, metadata) =>
    set((state) => {
      if (state.activeProject?.id !== projectId) return state;
      return {
        activeProject: { ...state.activeProject, metadata },
      };
    }),
}));
