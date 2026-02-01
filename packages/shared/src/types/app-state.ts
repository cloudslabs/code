export type AppStatus = 'idle' | 'processing' | 'error' | 'completed';

export interface AppStateUpdate {
  status: AppStatus;
  runningAgentCount: number;
  hasError: boolean;
  errorMessage?: string;
  unreadCompletions: number;
  planProgress?: { current: number; total: number };
  activeProjectTitle?: string;
}

export interface NotificationRequest {
  title: string;
  body: string;
  urgency: 'low' | 'normal' | 'critical';
}
