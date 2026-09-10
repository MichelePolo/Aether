import { beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToolCallDecisions } from '@/src/hooks/useToolCallDecisions';
import { useUiStore } from '@/src/stores/ui.store';
import { createToolEventConsumer } from './tool-events';
import { consumeRun } from './run-sse';
import { breakpointsApi } from './api/breakpoints.api';

beforeEach(() => { useUiStore.getState()._reset(); });
const request = (id: string) => ({ callId: id, qualifiedName: 'fs.write', args: {}, mode: 'gate', preview: { kind: 'plain' } });

it('queues approvals from concurrent runs and only clears calls owned by the closing stream', () => {
  renderHook(() => useToolCallDecisions());
  const first = createToolEventConsumer(); const second = createToolEventConsumer();
  act(() => { first.consume('tool_call_request', request('a')); second.consume('tool_call_request', request('b')); });
  expect(useUiStore.getState().approvalGateState?.event.callId).toBe('a');
  expect(useUiStore.getState().approvalGateQueue[0].event.callId).toBe('b');
  act(() => first.close());
  expect(useUiStore.getState().approvalGateState?.event.callId).toBe('b');
  act(() => second.close());
  expect(useUiStore.getState().approvalGateState).toBeNull();
});

it('does not open approval dialogs for automatically approved calls', () => {
  renderHook(() => useToolCallDecisions()); const stream = createToolEventConsumer();
  act(() => stream.consume('tool_call_request', { ...request('auto'), mode: 'auto' }));
  expect(useUiStore.getState().approvalGateState).toBeNull(); stream.close();
});

it('does not reopen an aborted gate when its asynchronous preview finishes late', async () => {
  let resolve!: (v: { kind: 'plain' }) => void;
  const spy = vi.spyOn(breakpointsApi, 'preview').mockImplementation(() => new Promise(r => { resolve = r; }));
  renderHook(() => useToolCallDecisions()); const stream = createToolEventConsumer();
  act(() => { stream.consume('tool_call_request', { ...request('late'), preview: undefined }); stream.close(); });
  await act(async () => { resolve({ kind: 'plain' }); });
  expect(useUiStore.getState().approvalGateState).toBeNull(); spy.mockRestore();
});

it('handles MCP gates inside the shared Swarm/TDD SSE consumer', async () => {
  renderHook(() => useToolCallDecisions());
  const data = `event: tool_call_request\ndata: ${JSON.stringify(request('run'))}\n\n`;
  const response = new Response(data, { headers: { 'Content-Type': 'text/event-stream' } });
  let opened = false;
  await act(async () => { await consumeRun(response, () => { opened = useUiStore.getState().approvalGateState?.event.callId === 'run'; }); });
  expect(opened).toBe(true);
  expect(useUiStore.getState().approvalGateState).toBeNull();
});
