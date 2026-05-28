import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { LiveThinkingBlock } from './LiveThinkingBlock';
import { ReasoningStepCard } from './ReasoningStepCard';

export function ReasoningDrawer() {
  const open = useUiStore((s) => s.reasoningDrawerOpen);
  const close = useUiStore((s) => s.closeReasoningDrawer);
  const focusedId = useUiStore((s) => s.focusedMessageId);

  const streamingId = useChatStore((s) => s.streamingId);
  const messages = useChatStore(useShallow((s) => s.messages));
  const currentReasoning = useChatStore((s) => s.currentReasoning);

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'model')?.id ?? null,
    [messages],
  );

  const activeId = focusedId ?? streamingId ?? lastAssistantId;
  const activeMessage = messages.find((m) => m.id === activeId);
  const isLive = streamingId !== null && activeId === streamingId;

  const steps = isLive ? currentReasoning.steps : (activeMessage?.reasoningSteps ?? []);
  const liveThinking = isLive ? currentReasoning.thinkingText : '';

  return (
    <aside
      role="complementary"
      aria-labelledby="reasoning-heading"
      className={`fixed right-0 top-0 bottom-0 z-40 w-96 bg-surface-2 border-l border-border-subtle flex flex-col motion-safe:transition-transform motion-safe:duration-200 glass ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      inert={!open}
    >
      <h2 id="reasoning-heading" className="sr-only">Reasoning</h2>
      <header className="h-12 px-4 border-b border-border-subtle flex items-center justify-between shrink-0">
        <span className="mono-label text-disclosure">Reasoning</span>
        <button
          type="button"
          aria-label="Close reasoning drawer"
          onClick={close}
          className="text-zinc-500 hover:text-white"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {liveThinking && <LiveThinkingBlock text={liveThinking} />}
        {steps.map((s) => (
          <ReasoningStepCard key={s.id} step={s} />
        ))}
        {steps.length === 0 && !liveThinking && (
          <p className="text-zinc-500 text-xs italic">No steps</p>
        )}
      </div>
    </aside>
  );
}
