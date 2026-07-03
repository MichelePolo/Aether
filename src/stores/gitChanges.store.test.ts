import { useGitChangesStore } from './gitChanges.store';
import type { WorkingChanges } from '@/src/lib/git-swimlanes';

vi.mock('@/src/lib/api/git.api', () => ({
  gitApi: {
    changes: vi.fn(),
    workingDiff: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    discard: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
  },
}));
import { gitApi } from '@/src/lib/api/git.api';

const EMPTY: WorkingChanges = { staged: [], unstaged: [], untracked: [], conflicted: [] };

beforeEach(() => {
  useGitChangesStore.getState().reset();
  vi.clearAllMocks();
});

describe('useGitChangesStore', () => {
  it('load populates changes', async () => {
    vi.mocked(gitApi.changes).mockResolvedValue({ ...EMPTY, unstaged: [{ path: 'a.txt', status: 'modified' }] });
    await useGitChangesStore.getState().load('ws1');
    expect(useGitChangesStore.getState().changes?.unstaged).toHaveLength(1);
    expect(useGitChangesStore.getState().activeWorkspaceId).toBe('ws1');
  });

  it('stage calls api then refreshes', async () => {
    vi.mocked(gitApi.changes).mockResolvedValue(EMPTY);
    await useGitChangesStore.getState().load('ws1');
    await useGitChangesStore.getState().stage(['a.txt']);
    expect(gitApi.stage).toHaveBeenCalledWith('ws1', ['a.txt']);
    expect(gitApi.changes).toHaveBeenCalledTimes(2); // load + refresh
  });

  it('commit clears the message and refreshes', async () => {
    vi.mocked(gitApi.changes).mockResolvedValue(EMPTY);
    vi.mocked(gitApi.commit).mockResolvedValue({ head: 'abc1234' });
    await useGitChangesStore.getState().load('ws1');
    useGitChangesStore.getState().setMessage('hello');
    await useGitChangesStore.getState().commit();
    expect(gitApi.commit).toHaveBeenCalledWith('ws1', 'hello');
    expect(useGitChangesStore.getState().message).toBe('');
  });

  it('push calls api then refreshes', async () => {
    vi.mocked(gitApi.changes).mockResolvedValue(EMPTY);
    await useGitChangesStore.getState().load('ws1');
    await useGitChangesStore.getState().push();
    expect(gitApi.push).toHaveBeenCalledWith('ws1');
    expect(gitApi.changes).toHaveBeenCalledTimes(2); // load + refresh
  });

  it('surfaces errors', async () => {
    vi.mocked(gitApi.changes).mockRejectedValue(new Error('boom'));
    await useGitChangesStore.getState().load('ws1');
    expect(useGitChangesStore.getState().error).toMatch(/boom/);
  });

  it('load() ignores a stale resolution superseded by a newer workspace load', async () => {
    let resolveA!: (v: WorkingChanges) => void;
    const aPromise = new Promise<WorkingChanges>((resolve) => {
      resolveA = resolve;
    });
    vi.mocked(gitApi.changes).mockImplementation((workspaceId: string) =>
      workspaceId === 'A' ? aPromise : Promise.resolve({ ...EMPTY, unstaged: [{ path: 'b.txt', status: 'modified' }] }),
    );

    const loadA = useGitChangesStore.getState().load('A');
    await useGitChangesStore.getState().load('B');
    expect(useGitChangesStore.getState().activeWorkspaceId).toBe('B');

    // Resolve A's stale request after B has already finished loading.
    resolveA({ ...EMPTY, unstaged: [{ path: 'a.txt', status: 'modified' }] });
    await loadA;

    const s = useGitChangesStore.getState();
    expect(s.activeWorkspaceId).toBe('B');
    expect(s.changes?.unstaged.map((c) => c.path)).toEqual(['b.txt']);
  });

  it('load() ignores a stale rejection superseded by a newer workspace load, without clobbering error', async () => {
    let rejectA!: (e: Error) => void;
    const aPromise = new Promise<WorkingChanges>((_resolve, reject) => {
      rejectA = reject;
    });
    vi.mocked(gitApi.changes).mockImplementation((workspaceId: string) =>
      workspaceId === 'A' ? aPromise : Promise.resolve({ ...EMPTY, unstaged: [{ path: 'b.txt', status: 'modified' }] }),
    );

    const loadA = useGitChangesStore.getState().load('A');
    await useGitChangesStore.getState().load('B');
    expect(useGitChangesStore.getState().activeWorkspaceId).toBe('B');

    // Reject A's stale request after B has already finished loading.
    rejectA(new Error('boom'));
    await loadA;

    const s = useGitChangesStore.getState();
    expect(s.activeWorkspaceId).toBe('B');
    expect(s.error).toBeNull();
    expect(s.changes?.unstaged.map((c) => c.path)).toEqual(['b.txt']);
  });

  it('refresh() ignores a stale rejection when a newer load has switched workspaces, without clobbering error', async () => {
    let rejectRefresh!: (e: Error) => void;
    const refreshPromise = new Promise<WorkingChanges>((_resolve, reject) => {
      rejectRefresh = reject;
    });

    vi.mocked(gitApi.changes)
      .mockResolvedValueOnce(EMPTY) // load('A')
      .mockImplementationOnce(() => refreshPromise) // refresh() while on 'A'
      .mockResolvedValueOnce({ ...EMPTY, unstaged: [{ path: 'b.txt', status: 'modified' }] }); // load('B')

    await useGitChangesStore.getState().load('A');
    const refreshA = useGitChangesStore.getState().refresh();

    await useGitChangesStore.getState().load('B');
    expect(useGitChangesStore.getState().activeWorkspaceId).toBe('B');

    // Reject the stale refresh() request after B has already finished loading.
    rejectRefresh(new Error('boom'));
    await refreshA;

    const s = useGitChangesStore.getState();
    expect(s.activeWorkspaceId).toBe('B');
    expect(s.error).toBeNull();
    expect(s.changes?.unstaged.map((c) => c.path)).toEqual(['b.txt']);
  });

  it('refresh() ignores a stale resolution when a newer load has switched workspaces', async () => {
    let resolveRefresh!: (v: WorkingChanges) => void;
    const refreshPromise = new Promise<WorkingChanges>((resolve) => {
      resolveRefresh = resolve;
    });

    vi.mocked(gitApi.changes)
      .mockResolvedValueOnce(EMPTY) // load('A')
      .mockImplementationOnce(() => refreshPromise) // refresh() while on 'A'
      .mockResolvedValueOnce({ ...EMPTY, unstaged: [{ path: 'b.txt', status: 'modified' }] }); // load('B')

    await useGitChangesStore.getState().load('A');
    const refreshA = useGitChangesStore.getState().refresh();

    await useGitChangesStore.getState().load('B');
    expect(useGitChangesStore.getState().activeWorkspaceId).toBe('B');

    // Resolve the stale refresh() request after B has already finished loading.
    resolveRefresh({ ...EMPTY, unstaged: [{ path: 'a.txt', status: 'modified' }] });
    await refreshA;

    const s = useGitChangesStore.getState();
    expect(s.activeWorkspaceId).toBe('B');
    expect(s.changes?.unstaged.map((c) => c.path)).toEqual(['b.txt']);
  });
});
