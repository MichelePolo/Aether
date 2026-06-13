import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore, contextSizeOfActive } from './chat.store';
import type { ReasoningStep } from '@/src/types/reasoning.types';
import type { QueuedAttachment } from '@/src/types/attachment.types';

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

describe('useChatStore tokens (slice-19)', () => {
  it('finishAssistant merges tokensIn and tokensOut onto the message', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake', tokensIn: 80, tokensOut: 40 });
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.tokensIn).toBe(80);
    expect(last?.tokensOut).toBe(40);
  });

  it('contextSizeOfActive returns null when no assistant message', () => {
    useChatStore.getState().appendUser('hello');
    expect(contextSizeOfActive(useChatStore.getState())).toBeNull();
  });

  it('contextSizeOfActive returns null when assistant has no tokens', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake' });
    expect(contextSizeOfActive(useChatStore.getState())).toBeNull();
  });

  it('contextSizeOfActive returns { prompt, reply, total } from last assistant message', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake', tokensIn: 100, tokensOut: 50 });
    const result = contextSizeOfActive(useChatStore.getState());
    expect(result).toEqual({ prompt: 100, reply: 50, total: 150 });
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

function makeFile(name: string, mime: string, content: string): File {
  return new File([content], name, { type: mime });
}

describe('chat.store.queuedAttachments', () => {
  beforeEach(() => useChatStore.getState().reset());

  it('queueAttachments appends a valid PNG and clears error', async () => {
    const file = makeFile('a.png', 'image/png', 'PNGBYTES');
    await useChatStore.getState().queueAttachments([file]);
    const q = useChatStore.getState().queuedAttachments;
    expect(q).toHaveLength(1);
    expect(q[0].name).toBe('a.png');
    expect(q[0].mime).toBe('image/png');
    expect(q[0].base64.length).toBeGreaterThan(0);
    expect(q[0].dataUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(useChatStore.getState().error).toBeNull();
  });

  it('rejects when count would exceed MAX_ATTACHMENTS=5', async () => {
    useChatStore.setState({
      queuedAttachments: Array.from({ length: 5 }).map((_, i): QueuedAttachment => ({
        id: `q${i}`, name: `a${i}.png`, mime: 'image/png', size: 1, base64: 'AA==', dataUri: 'data:image/png;base64,AA==',
      })),
    });
    await useChatStore.getState().queueAttachments([makeFile('extra.png', 'image/png', 'X')]);
    expect(useChatStore.getState().queuedAttachments).toHaveLength(5);
    expect(useChatStore.getState().error).toMatch(/Too many attachments/i);
  });

  it('rejects when total size would exceed 10 MB', async () => {
    const huge = makeFile('big.png', 'image/png', 'a'.repeat(11 * 1024 * 1024));
    await useChatStore.getState().queueAttachments([huge]);
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
    expect(useChatStore.getState().error).toMatch(/too large/i);
  });

  it('rejects an unsupported MIME with a per-file message', async () => {
    const bad = makeFile('a.pdf', 'application/pdf', 'PDF');
    await useChatStore.getState().queueAttachments([bad]);
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
    expect(useChatStore.getState().error).toMatch(/a\.pdf/);
  });

  it('removeQueuedAttachment filters by id', async () => {
    await useChatStore.getState().queueAttachments([makeFile('a.png', 'image/png', 'x')]);
    const id = useChatStore.getState().queuedAttachments[0].id;
    useChatStore.getState().removeQueuedAttachment(id);
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
  });

  it('clearQueuedAttachments empties the queue', async () => {
    await useChatStore.getState().queueAttachments([makeFile('a.png', 'image/png', 'x')]);
    useChatStore.getState().clearQueuedAttachments();
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
  });
});

describe('useChatStore stickyApprovals', () => {
  beforeEach(() => useChatStore.getState()._reset());

  it('starts empty', () => {
    expect(useChatStore.getState().stickyApprovals.size).toBe(0);
  });

  it('addStickyApproval adds the tool name', () => {
    useChatStore.getState().addStickyApproval('fs.write_file');
    expect(useChatStore.getState().stickyApprovals.has('fs.write_file')).toBe(true);
  });

  it('reset clears stickyApprovals', () => {
    useChatStore.getState().addStickyApproval('fs.write_file');
    useChatStore.getState().reset();
    expect(useChatStore.getState().stickyApprovals.size).toBe(0);
  });

  it('removeStickyApproval removes only the named tool', () => {
    useChatStore.getState().addStickyApproval('fs.write_file');
    useChatStore.getState().addStickyApproval('git.git_commit');
    useChatStore.getState().removeStickyApproval('fs.write_file');
    const sticky = useChatStore.getState().stickyApprovals;
    expect(sticky.has('fs.write_file')).toBe(false);
    expect(sticky.has('git.git_commit')).toBe(true);
  });
});
