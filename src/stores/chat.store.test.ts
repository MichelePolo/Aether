import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat.store';
import type { ReasoningStep } from '@/src/types/reasoning.types';

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('useChatStore basic actions', () => {
  it('starts with empty state', () => {
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streamingId).toBeNull();
    expect(s.hydrated).toBe(false);
    expect(s.currentReasoning).toEqual({ thinkingText: '', steps: [] });
  });

  it('hydrate sets messages and hydrated flag', () => {
    useChatStore.getState().hydrate([
      { id: 'a', role: 'user', text: 'hi', timestamp: 1 },
    ]);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().hydrated).toBe(true);
  });

  it('appendUser pushes a user message', () => {
    const { id } = useChatStore.getState().appendUser('hello');
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ id, role: 'user', text: 'hello' });
  });

  it('startAssistant creates empty model bubble + resets currentReasoning', () => {
    useChatStore.setState({
      currentReasoning: { thinkingText: 'old', steps: [{ id: 'x' } as ReasoningStep] },
    });
    const { id } = useChatStore.getState().startAssistant();
    const s = useChatStore.getState();
    expect(s.streamingId).toBe(id);
    expect(s.currentReasoning).toEqual({ thinkingText: '', steps: [] });
  });

  it('appendChunk concatenates text on the right message', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().appendChunk(id, 'Hello');
    useChatStore.getState().appendChunk(id, ' world');
    expect(useChatStore.getState().messages.at(-1)?.text).toBe('Hello world');
  });

  it('finishAssistant clears streamingId and sets model + interrupted', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake-1', interrupted: false });
    const s = useChatStore.getState();
    expect(s.streamingId).toBeNull();
    expect(s.messages.at(-1)).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('failAssistant sets error and retryable, clears streamingId + currentReasoning', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.setState({ currentReasoning: { thinkingText: 'live', steps: [] } });
    useChatStore.getState().failAssistant(id, 'boom', true);
    const last = useChatStore.getState().messages.at(-1);
    expect(last).toMatchObject({ error: 'boom', retryable: true });
    expect(useChatStore.getState().streamingId).toBeNull();
    expect(useChatStore.getState().currentReasoning).toEqual({ thinkingText: '', steps: [] });
  });

  it('abort calls abortController.abort and clears it', () => {
    const c = new AbortController();
    useChatStore.getState().setAbortController(c);
    let aborted = false;
    c.signal.addEventListener('abort', () => { aborted = true; });
    useChatStore.getState().abort();
    expect(aborted).toBe(true);
    expect(useChatStore.getState().abortController).toBeNull();
  });

  it('reset clears everything', () => {
    useChatStore.getState().appendUser('x');
    useChatStore.getState().startAssistant();
    useChatStore.setState({ currentReasoning: { thinkingText: 'live', steps: [] } });
    useChatStore.getState().reset();
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streamingId).toBeNull();
    expect(s.currentReasoning).toEqual({ thinkingText: '', steps: [] });
  });
});

describe('useChatStore reasoning actions', () => {
  it('appendThinkingChunk accumulates into currentReasoning.thinkingText', () => {
    useChatStore.getState().appendThinkingChunk('a');
    useChatStore.getState().appendThinkingChunk('b');
    expect(useChatStore.getState().currentReasoning.thinkingText).toBe('ab');
  });

  it('appendReasoningStep pushes into currentReasoning.steps', () => {
    const s: ReasoningStep = {
      id: '1', type: 'context_fetch', title: 't', content: 'c', timestamp: 1,
    };
    useChatStore.getState().appendReasoningStep(s);
    expect(useChatStore.getState().currentReasoning.steps).toEqual([s]);
  });

  it('finishAssistant accepts reasoningSteps and attaches them to message', () => {
    const { id } = useChatStore.getState().startAssistant();
    const steps: ReasoningStep[] = [{
      id: '1', type: 'context_fetch', title: 't', content: 'c', timestamp: 1,
    }];
    useChatStore.getState().finishAssistant(id, { model: 'fake', reasoningSteps: steps });
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.reasoningSteps).toEqual(steps);
  });

  it('finishAssistant clears currentReasoning', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.setState({ currentReasoning: { thinkingText: 'live', steps: [] } });
    useChatStore.getState().finishAssistant(id, { model: 'fake' });
    expect(useChatStore.getState().currentReasoning).toEqual({ thinkingText: '', steps: [] });
  });
});
