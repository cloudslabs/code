import { useState, useEffect, useCallback } from 'react';
import { usePlanPanelStore } from '../../stores/plan-panel-store.js';
import { wsClient } from '../../lib/ws-client.js';
import { PlanPanelHeader } from './PlanPanelHeader.js';
import { PlanAgentActivity } from './PlanAgentActivity.js';
import { PlanStepsPanel } from './PlanStepsPanel.js';
import { PlanChatArea } from './PlanChatArea.js';

export function PlanModePanel() {
  const isOpen = usePlanPanelStore((s) => s.isOpen);
  const currentPlan = usePlanPanelStore((s) => s.currentPlan);

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // Mount then animate in
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
        });
      });
    } else if (mounted) {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, mounted]);

  const handleClose = useCallback(() => {
    wsClient.send({ type: 'plan:interrupt' });
    usePlanPanelStore.getState().closePanel();
  }, []);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    },
    [handleClose],
  );

  useEffect(() => {
    if (mounted) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [mounted, handleKeyDown]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel — slides from left */}
      <div
        className={`absolute top-0 left-0 bottom-0 w-[600px] max-w-[80vw] bg-zinc-900 border-r border-zinc-700 flex flex-col transition-transform duration-300 ease-out ${
          visible ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <PlanPanelHeader onClose={handleClose} />
        <PlanAgentActivity />
        {currentPlan && <PlanStepsPanel />}
        <PlanChatArea />
      </div>
    </div>
  );
}
