import { useEffect } from 'react';
import type { ServerMessage } from '@cloudscode/shared';
import { wsClient } from '../lib/ws-client.js';
import { useChatStore } from '../stores/chat-store.js';
import { useAgentStore } from '../stores/agent-store.js';
import { useProjectStore } from '../stores/project-store.js';
import { useSettingsStore } from '../stores/settings-store.js';

function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case 'chat:token': {
      const chat = useChatStore.getState();
      if (!chat.isStreaming) {
        chat.startStreaming();
      }
      chat.appendToken(message.payload.token);
      break;
    }

    case 'chat:message': {
      const chat = useChatStore.getState();
      if (chat.isStreaming && message.payload.role === 'assistant') {
        chat.finishStreaming();
      }
      // User messages are already added locally in MessageInput — don't duplicate
      break;
    }

    case 'chat:error': {
      useChatStore.getState().setError(message.payload.message);
      break;
    }

    case 'agent:started': {
      useAgentStore.getState().addAgent(message.payload);
      break;
    }

    case 'agent:stopped': {
      useAgentStore.getState().updateAgent(message.payload);
      break;
    }

    case 'agent:tool': {
      useAgentStore.getState().addToolActivity(message.payload);
      break;
    }

    case 'agent:result': {
      break;
    }

    case 'context:update': {
      useSettingsStore.getState().setContextBudget(message.payload);
      break;
    }

    case 'project:created':
    case 'project:resumed': {
      const projectStore = useProjectStore.getState();
      projectStore.setActiveProject(message.payload);
      if (message.type === 'project:created') {
        projectStore.addProject({
          id: message.payload.id,
          title: message.payload.title,
          status: message.payload.status,
          totalCostUsd: message.payload.totalCostUsd,
          updatedAt: message.payload.updatedAt,
          description: message.payload.description,
          primaryLanguage: message.payload.primaryLanguage,
        });
      }
      break;
    }

    case 'project:list': {
      useProjectStore.getState().setProjects(message.payload.projects);
      break;
    }

    case 'project:messages': {
      const chat = useChatStore.getState();
      chat.loadMessages(
        message.payload.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          agentId: m.agentId ?? 'orchestrator',
          timestamp: m.createdAt * 1000,
        })),
      );
      break;
    }

    case 'memory:updated': {
      break;
    }

    case 'project:settings_updated': {
      const projectStore = useProjectStore.getState();
      const { projectId, fullMetadata } = message.payload;
      projectStore.updateProjectMetadata(projectId, fullMetadata);
      break;
    }
  }
}

export function useWebSocket() {
  useEffect(() => {
    // connect() is a no-op if already connected, safe for StrictMode double-invoke
    wsClient.connect();

    const unsubscribe = wsClient.onMessage(handleMessage);

    return () => {
      // Only unsubscribe the handler; keep the singleton WS connection alive
      unsubscribe();
    };
  }, []);
}
