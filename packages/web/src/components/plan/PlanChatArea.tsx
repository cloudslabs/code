import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Square, User, Bot } from 'lucide-react';
import { wsClient } from '../../lib/ws-client.js';
import { usePlanPanelStore } from '../../stores/plan-panel-store.js';
import { StreamingText } from '../chat/StreamingText.js';
import { Markdown } from '../chat/Markdown.js';

export function PlanChatArea() {
  const messages = usePlanPanelStore((s) => s.messages);
  const isStreaming = usePlanPanelStore((s) => s.isStreaming);
  const streamingContent = usePlanPanelStore((s) => s.streamingContent);
  const error = usePlanPanelStore((s) => s.error);

  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Add user message locally
    usePlanPanelStore.getState().addMessage({
      id: `plan-user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      agentId: 'local',
      timestamp: Date.now(),
    });

    // Send to server via plan channel
    wsClient.send({
      type: 'plan:send',
      payload: { content: trimmed },
    });

    setInput('');
    usePlanPanelStore.getState().startStreaming();

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input]);

  const handleInterrupt = () => {
    wsClient.send({ type: 'plan:interrupt' });
    usePlanPanelStore.getState().finishStreaming();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) {
        handleSend();
      }
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-8 text-sm text-zinc-500">
            Describe what you want to build and I'll help you create a plan.
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-3">
            <div
              className={`mt-1 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                msg.role === 'user' ? 'bg-zinc-700' : 'bg-indigo-600'
              }`}
            >
              {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-zinc-500 mb-1">
                {msg.role === 'user' ? 'You' : 'Plan Assistant'}
              </div>
              {msg.role === 'assistant' ? (
                <Markdown content={msg.content} />
              ) : (
                <div className="text-sm text-zinc-200 whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {isStreaming && streamingContent && (
          <div className="flex gap-3">
            <div className="mt-1 shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-indigo-600">
              <Bot size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-zinc-500 mb-1">Plan Assistant</div>
              <StreamingText content={streamingContent} />
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mx-10 p-3 rounded-lg bg-red-950/50 border border-red-900 text-sm text-red-300">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-700 p-4">
        <div className="flex gap-2 items-end max-w-3xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build..."
            rows={1}
            className="flex-1 bg-zinc-850 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
          />
          {isStreaming ? (
            <button
              onClick={handleInterrupt}
              className="p-3 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 disabled:hover:bg-indigo-600"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
