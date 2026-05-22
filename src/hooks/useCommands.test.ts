import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/src/components/layout/HiddenImportInput', () => ({
  triggerImportOpen: vi.fn(),
}));

import { useCommands } from './useCommands';
import { triggerImportOpen } from '@/src/components/layout/HiddenImportInput';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  vi.mocked(triggerImportOpen).mockClear();
});

function ids(cmds: { id: string }[]): string[] {
  return cmds.map((c) => c.id);
}

describe('useCommands', () => {
  it('always includes static commands', () => {
    const { result } = renderHook(() => useCommands());
    expect(ids(result.current)).toEqual(
      expect.arrayContaining([
        'sessions.new',
        'profiles.open',
        'profiles.saveNew',
        'ui.toggleSidebar',
        'ui.toggleThinking',
        'ui.openReasoning',
        'context.addSkill',
        'context.addTool',
        'context.addMcp',
        'context.editSystem',
      ]),
    );
  });

  it('omits rename/delete when no active session', () => {
    const { result } = renderHook(() => useCommands());
    expect(ids(result.current)).not.toEqual(expect.arrayContaining(['sessions.rename', 'sessions.delete']));
  });

  it('includes rename/delete + switch-to-others when active session set', () => {
    useSessionsStore.setState({
      sessions: [
        { id: 'a', title: 'Alpha', createdAt: 1, updatedAt: 1 },
        { id: 'b', title: 'Beta', createdAt: 2, updatedAt: 2 },
      ] as never,
      activeSessionId: 'a',
      hydrated: true,
    });
    const { result } = renderHook(() => useCommands());
    const list = ids(result.current);
    expect(list).toContain('sessions.rename');
    expect(list).toContain('sessions.delete');
    expect(list).toContain('sessions.switch.b');
    expect(list).not.toContain('sessions.switch.a');
  });

  it('includes profiles.apply.<id> excluding active profile', () => {
    useProfilesStore.setState({
      profiles: [
        { id: 'p1', name: 'One', createdAt: 0, updatedAt: 0 },
        { id: 'p2', name: 'Two', createdAt: 0, updatedAt: 0 },
      ],
      activeProfileId: 'p1',
      hydrated: true,
    });
    const list = ids(renderHook(() => useCommands()).result.current);
    expect(list).toContain('profiles.apply.p2');
    expect(list).not.toContain('profiles.apply.p1');
  });

  it('omits ui.openReasoning when drawer already open', () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    const list = ids(renderHook(() => useCommands()).result.current);
    expect(list).not.toContain('ui.openReasoning');
  });

  it('attaches shortcut hints', () => {
    const { result } = renderHook(() => useCommands());
    const newSession = result.current.find((c) => c.id === 'sessions.new');
    const sidebar = result.current.find((c) => c.id === 'ui.toggleSidebar');
    expect(newSession?.shortcut).toBeTruthy();
    expect(sidebar?.shortcut).toBeTruthy();
  });
});

describe('useCommands — sessions.import', () => {
  it('exposes an "Import session…" command that triggers the hidden input', async () => {
    const { result } = renderHook(() => useCommands());
    const cmd = result.current.find((c) => c.id === 'sessions.import');
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe('Import session…');
    await cmd!.run();
    expect(triggerImportOpen).toHaveBeenCalled();
  });
});
