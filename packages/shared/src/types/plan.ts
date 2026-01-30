export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
export type PlanStatus = 'drafting' | 'ready' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  agentType: 'code-analyst' | 'implementer' | 'test-runner' | 'researcher';
  status: PlanStepStatus;
  dependencies?: string[];
  estimatedComplexity?: 'low' | 'medium' | 'high';
}

export interface Plan {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PlanListItem {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  status: PlanStatus;
  stepCount: number;
  completedStepCount: number;
  createdAt: number;
  updatedAt: number;
}
