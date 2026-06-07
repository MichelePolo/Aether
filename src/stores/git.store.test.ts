import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGitStore } from './git.store';
import { gitApi } from '@/src/lib/api/git.api';
import type { CommitNode } from '@/src/lib/git-swimlanes';

vi.mock('@/src/lib/api/git.api', () => ({
  gitApi: { status: vi.fn(), log: vi.fn(), diff: vi.fn() },
}));

const mockApi = vi.mocked(gitApi);

function commit(hash: string): CommitNode {
  return {
    hash,
    parents: [],
    author: 'a',
    date: '2026-01-01',
    subject: 's',
    branches: [],
    tags: [],
    head: false,
    files: [],
  };
}

describe('useGitStore', () => {
  beforeEach(() => {
    useGitStore.getState().reset();
    vi.clearAllMocks();
  });

  it('load() populates commits when isRepo is true', async () => {
    mockApi.status.mockResolvedValue({ isRepo: true, root: '/r', head: 'abc' });
    mockApi.log.mockResolvedValue({ commits: [commit('c1'), commit('c2')], truncated: true });

    await useGitStore.getState().load('w1', 50);
    const s = useGitStore.getState();

    expect(mockApi.status).toHaveBeenCalledWith('w1');
    expect(mockApi.log).toHaveBeenCalledWith('w1', 50);
    expect(s.commits).toHaveLength(2);
    expect(s.truncated).toBe(true);
    expect(s.status?.isRepo).toBe(true);
    expect(s.loading).toBe(false);
    expect(s.activeWorkspaceId).toBe('w1');
  });

  it('load() does not call log when isRepo is false', async () => {
    mockApi.status.mockResolvedValue({ isRepo: false });

    await useGitStore.getState().load('w1');
    const s = useGitStore.getState();

    expect(mockApi.log).not.toHaveBeenCalled();
    expect(s.commits).toEqual([]);
    expect(s.status?.isRepo).toBe(false);
    expect(s.loading).toBe(false);
  });

  it('load() sets error when status throws', async () => {
    mockApi.status.mockRejectedValue(new Error('boom'));

    await useGitStore.getState().load('w1');
    const s = useGitStore.getState();

    expect(s.error).toBe('boom');
    expect(s.loading).toBe(false);
    expect(mockApi.log).not.toHaveBeenCalled();
  });

  it('load() sets error when log throws', async () => {
    mockApi.status.mockResolvedValue({ isRepo: true });
    mockApi.log.mockRejectedValue(new Error('logfail'));

    await useGitStore.getState().load('w1');
    const s = useGitStore.getState();

    expect(s.error).toBe('logfail');
    expect(s.loading).toBe(false);
  });

  it('toggleExpand() adds then removes with a fresh Set identity each time', () => {
    const empty = useGitStore.getState().expanded;

    useGitStore.getState().toggleExpand('h1');
    const afterAdd = useGitStore.getState().expanded;
    expect(afterAdd.has('h1')).toBe(true);
    expect(afterAdd).not.toBe(empty);

    useGitStore.getState().toggleExpand('h1');
    const afterRemove = useGitStore.getState().expanded;
    expect(afterRemove.has('h1')).toBe(false);
    expect(afterRemove).not.toBe(afterAdd);
  });

  it('refresh() is a no-op without an activeWorkspaceId', async () => {
    await useGitStore.getState().refresh();
    expect(mockApi.status).not.toHaveBeenCalled();
  });

  it('refresh() re-loads using the activeWorkspaceId', async () => {
    mockApi.status.mockResolvedValue({ isRepo: true });
    mockApi.log.mockResolvedValue({ commits: [], truncated: false });

    await useGitStore.getState().load('w1');
    mockApi.status.mockClear();

    await useGitStore.getState().refresh();
    expect(mockApi.status).toHaveBeenCalledWith('w1');
  });

  it('reset() clears commits, expanded, status and activeWorkspaceId', async () => {
    mockApi.status.mockResolvedValue({ isRepo: true });
    mockApi.log.mockResolvedValue({ commits: [commit('c1')], truncated: false });

    await useGitStore.getState().load('w1');
    useGitStore.getState().toggleExpand('c1');

    useGitStore.getState().reset();
    const s = useGitStore.getState();

    expect(s.status).toBeNull();
    expect(s.commits).toEqual([]);
    expect(s.expanded.size).toBe(0);
    expect(s.activeWorkspaceId).toBeNull();
    expect(s.error).toBeNull();
    expect(s.truncated).toBe(false);
  });
});
