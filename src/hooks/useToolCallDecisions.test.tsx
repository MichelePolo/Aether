import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { emitToolCallRequest, useToolCallDecisions } from './useToolCallDecisions';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';

vi.mock('@/src/lib/api/mcp.api', () => ({
  mcpApi: { decide: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/src/lib/api/breakpoints.api', () => ({
  breakpointsApi: { preview: vi.fn().mockResolvedValue({ kind: 'plain' }) },
}));

describe('useToolCallDecisions', () => {
  beforeEach(() => {
    useChatStore.getState()._reset();
    useUiStore.getState().closeApprovalGate();
  });

  it('sticky tool name → immediately approves without opening the gate', async () => {
    const { mcpApi } = await import('@/src/lib/api/mcp.api');
    useChatStore.getState().addStickyApproval('fs.write_file');
    renderHook(() => useToolCallDecisions());
    act(() => emitToolCallRequest({ callId: 'c1', qualifiedName: 'fs.write_file', args: {} }));
    await Promise.resolve();
    await Promise.resolve();
    expect(mcpApi.decide).toHaveBeenCalledWith('c1', 'approve');
    expect(useUiStore.getState().approvalGateState).toBeNull();
  });

  it('non-sticky tool → fetches preview and opens approval gate', async () => {
    const { breakpointsApi } = await import('@/src/lib/api/breakpoints.api');
    renderHook(() => useToolCallDecisions());
    act(() => emitToolCallRequest({ callId: 'c2', qualifiedName: 'fs.write_file', args: { path: '/x' } }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(breakpointsApi.preview).toHaveBeenCalledWith({
      qualifiedName: 'fs.write_file',
      args: { path: '/x' },
    });
    expect(useUiStore.getState().approvalGateState?.event.callId).toBe('c2');
  });

  it('SSE-embedded preview → opens gate with that preview WITHOUT calling breakpointsApi.preview', async () => {
    const { breakpointsApi } = await import('@/src/lib/api/breakpoints.api');
    vi.mocked(breakpointsApi.preview).mockClear();
    const embeddedPreview = { kind: 'gitDiff' as const, unified: 'diff --git a/f b/f\n', title: 'f' };
    renderHook(() => useToolCallDecisions());
    act(() =>
      emitToolCallRequest({
        callId: 'c3',
        qualifiedName: 'fs.write_file',
        args: { path: '/y' },
        preview: embeddedPreview,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(breakpointsApi.preview).not.toHaveBeenCalled();
    const gate = useUiStore.getState().approvalGateState;
    expect(gate?.event.callId).toBe('c3');
    expect(gate?.preview).toEqual(embeddedPreview);
  });

  it('SSE event without preview → HTTP fallback still fires', async () => {
    const { breakpointsApi } = await import('@/src/lib/api/breakpoints.api');
    vi.mocked(breakpointsApi.preview).mockClear();
    renderHook(() => useToolCallDecisions());
    act(() =>
      emitToolCallRequest({ callId: 'c4', qualifiedName: 'fs.read_file', args: { path: '/z' } }),
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(breakpointsApi.preview).toHaveBeenCalledWith({
      qualifiedName: 'fs.read_file',
      args: { path: '/z' },
    });
    expect(useUiStore.getState().approvalGateState?.event.callId).toBe('c4');
  });
});
