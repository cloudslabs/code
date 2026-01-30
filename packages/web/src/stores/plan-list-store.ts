import { create } from 'zustand';
import type { Plan, PlanListItem } from '@cloudscode/shared';
import { api } from '../lib/api-client.js';

interface PlanListState {
  plans: PlanListItem[];
  loading: boolean;
  selectedPlanId: string | null;

  loadPlans: (projectId: string) => Promise<void>;
  setPlans: (plans: PlanListItem[]) => void;
  removePlan: (id: string) => void;
  setSelectedPlan: (id: string | null) => void;
  updatePlanInList: (plan: Plan | PlanListItem) => void;
}

export const usePlanListStore = create<PlanListState>((set) => ({
  plans: [],
  loading: false,
  selectedPlanId: null,

  loadPlans: async (projectId: string) => {
    set({ loading: true });
    try {
      const { plans } = await api.listPlans(projectId);
      set({ plans, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setPlans: (plans) => set({ plans }),

  removePlan: (id) =>
    set((state) => ({
      plans: state.plans.filter((p) => p.id !== id),
      selectedPlanId: state.selectedPlanId === id ? null : state.selectedPlanId,
    })),

  setSelectedPlan: (id) => set({ selectedPlanId: id }),

  updatePlanInList: (plan) =>
    set((state) => {
      // Convert Plan to PlanListItem if needed
      const listItem: PlanListItem = {
        id: plan.id,
        projectId: plan.projectId,
        title: plan.title,
        summary: plan.summary,
        status: plan.status as PlanListItem['status'],
        stepCount: 'stepCount' in plan ? (plan as PlanListItem).stepCount : Array.isArray((plan as any).steps) ? (plan as any).steps.length : 0,
        completedStepCount: 'completedStepCount' in plan ? (plan as PlanListItem).completedStepCount : Array.isArray((plan as any).steps) ? (plan as any).steps.filter((s: any) => s.status === 'completed').length : 0,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      };

      const exists = state.plans.some((p) => p.id === plan.id);
      if (exists) {
        return {
          plans: state.plans.map((p) => (p.id === plan.id ? listItem : p)),
        };
      }
      return {
        plans: [listItem, ...state.plans],
      };
    }),
}));
