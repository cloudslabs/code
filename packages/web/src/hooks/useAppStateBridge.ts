import { useEffect, useRef } from 'react';
import type { AppStatus, AppStateUpdate } from '@cloudscode/shared';
import { useAgentStore } from '../stores/agent-store.js';
import { useChatStore } from '../stores/chat-store.js';
import { usePlanPanelStore } from '../stores/plan-panel-store.js';
import { useProjectStore } from '../stores/project-store.js';

const DEBOUNCE_MS = 500;
const ERROR_CLEAR_MS = 10_000;

/**
 * Derives high-level AppStatus from Zustand stores and forwards it
 * to the Electron main process via IPC for tray, dock, badge, and
 * notification management.
 */
export function useAppStateBridge() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatusRef = useRef<AppStatus>('idle');
  const windowFocusedRef = useRef(true);
  const unreadCompletionsRef = useRef(0);
  const prevRunningRef = useRef(false);

  // Reset unread count when window regains focus
  useEffect(() => {
    const onFocus = () => {
      windowFocusedRef.current = true;
      unreadCompletionsRef.current = 0;
    };
    const onBlur = () => {
      windowFocusedRef.current = false;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        windowFocusedRef.current = true;
        unreadCompletionsRef.current = 0;
      } else {
        windowFocusedRef.current = false;
      }
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Subscribe to store changes and derive status
  useEffect(() => {
    if (!window.electronAPI?.sendAppState) return;

    const send = (state: AppStateUpdate) => {
      window.electronAPI?.sendAppState(state);
    };

    const derive = () => {
      const agents = useAgentStore.getState().agents;
      const chatError = useChatStore.getState().error;
      const planState = usePlanPanelStore.getState();
      const planError = planState.error;
      const currentPlan = planState.currentPlan;
      const activeProject = useProjectStore.getState().activeProject;

      // Count running agents
      let runningCount = 0;
      for (const agent of agents.values()) {
        if (agent.status === 'running') runningCount++;
      }
      for (const agent of planState.planAgents.values()) {
        if (agent.status === 'running') runningCount++;
      }

      const wasRunning = prevRunningRef.current;
      const isRunning = runningCount > 0;
      prevRunningRef.current = isRunning;

      // Derive status
      let status: AppStatus = 'idle';
      const hasError = !!(chatError || planError);

      if (isRunning) {
        status = 'processing';
      } else if (hasError) {
        status = 'error';
        // Auto-clear error status after timeout
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => {
          // Re-derive to clear error if no longer present
          derive();
        }, ERROR_CLEAR_MS);
      } else if (wasRunning && !isRunning && !windowFocusedRef.current) {
        status = 'completed';
        unreadCompletionsRef.current++;

        // Fire notification for completion while unfocused
        window.electronAPI?.sendNotification({
          title: 'Task Completed',
          body: activeProject?.title
            ? `Agent finished in ${activeProject.title}`
            : 'Agent task has completed',
          urgency: 'normal',
        });
      }

      // Plan progress
      let planProgress: { current: number; total: number } | undefined;
      if (currentPlan && currentPlan.steps.length > 0) {
        const completed = currentPlan.steps.filter(
          (s) => s.status === 'completed' || s.status === 'skipped',
        ).length;
        planProgress = { current: completed, total: currentPlan.steps.length };
      }

      const update: AppStateUpdate = {
        status,
        runningAgentCount: runningCount,
        hasError,
        errorMessage: chatError || planError || undefined,
        unreadCompletions: unreadCompletionsRef.current,
        planProgress,
        activeProjectTitle: activeProject?.title ?? undefined,
      };

      lastStatusRef.current = status;
      send(update);
    };

    // Debounced derive
    const debouncedDerive = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(derive, DEBOUNCE_MS);
    };

    // Subscribe to all relevant stores
    const unsubs = [
      useAgentStore.subscribe(debouncedDerive),
      useChatStore.subscribe(debouncedDerive),
      usePlanPanelStore.subscribe(debouncedDerive),
      useProjectStore.subscribe(debouncedDerive),
    ];

    // Send initial state
    derive();

    return () => {
      unsubs.forEach((u) => u());
      if (timerRef.current) clearTimeout(timerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Listen for tray actions from main process
  useEffect(() => {
    const unsub = window.electronAPI?.onTrayAction?.((action: string) => {
      if (action === 'show-window') {
        // Main process handles the actual show/focus
        // Reset unread count on user interaction
        unreadCompletionsRef.current = 0;
      }
    });
    return () => { unsub?.(); };
  }, []);
}
