import { useGitChangesStore } from './gitChanges.store';

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

const EMPTY = { staged: [], unstaged: [], untracked: [], conflicted: [] };

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

  it('surfaces errors', async () => {
    vi.mocked(gitApi.changes).mockRejectedValue(new Error('boom'));
    await useGitChangesStore.getState().load('ws1');
    expect(useGitChangesStore.getState().error).toMatch(/boom/);
  });
});
