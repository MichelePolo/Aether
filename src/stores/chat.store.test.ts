import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat.store';

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('useChatStore', () => {
  it('starts with empty state', () => {
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streamingId).toBeNull();
    expect(s.hydrated).toBe(false);
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

  it('startAssistant creates empty model bubble and sets streamingId', () => {
    const { id } = useChatStore.getState().startAssistant();
    const s = useChatStore.getState();
    expect(s.streamingId).toBe(id);
    expect(s.messages.at(-1)).toMatchObject({ id, role: 'model', text: '' });
  });

  it('appendChunk concatenates text on the right message', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().appendChunk(id, 'Hello');
    useChatStore.getState().appendChunk(id, ' world');
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.text).toBe('Hello world');
  });

  it('finishAssistant clears streamingId and sets model + interrupted', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake-1', interrupted: false });
    const s = useChatStore.getState();
    expect(s.streamingId).toBeNull();
    expect(s.messages.at(-1)).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('failAssistant sets error and retryable, clears streamingId', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().failAssistant(id, 'boom', true);
    const last = useChatStore.getState().messages.at(-1);
    expect(last).toMatchObject({ error: 'boom', retryable: true });
    expect(useChatStore.getState().streamingId).toBeNull();
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

  it('abort is no-op when no controller', () => {
    expect(() => useChatStore.getState().abort()).not.toThrow();
  });

  it('reset clears everything', () => {
    useChatStore.getState().appendUser('x');
    useChatStore.getState().startAssistant();
    useChatStore.getState().reset();
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streamingId).toBeNull();
  });
});
