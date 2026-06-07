import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { GitError, runGit } from './git.runner';

// These tests mock child_process.spawn to deterministically exercise the
// defensive branches (spawn error, timeout SIGTERM->SIGKILL, output cap) that
// the real-git tests in git.runner.test.ts cannot trigger reliably.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
const spawnMock = vi.mocked(spawn);

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

const CWD = tmpdir(); // a real existing directory so cwd validation passes

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('runGit (mocked spawn) — defensive branches', () => {
  it('rejects with GitError when the child emits an error', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = runGit(['log'], CWD);
    child.emit('error', new Error('boom'));
    await expect(p).rejects.toBeInstanceOf(GitError);
    await expect(p).rejects.toThrow(/git spawn failed: boom/);
  });

  it('times out: rejects GIT_TIMEOUT and escalates SIGTERM -> SIGKILL', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = runGit(['log'], CWD, { timeoutMs: 5 });
    p.catch(() => {}); // avoid unhandled rejection warning before assertion
    await vi.advanceTimersByTimeAsync(6);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(600);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(p).rejects.toThrow(/timed out after 5ms/);
  });

  it('caps oversized stdout and appends the truncation marker', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = runGit(['log'], CWD);
    child.stdout.emit('data', Buffer.from('x'.repeat(1024 * 1024 + 50)));
    child.emit('exit', 0);
    const result = await p;
    expect(result.code).toBe(0);
    expect(result.stdout.endsWith('[output truncated]')).toBe(true);
    expect(result.stdout.length).toBeLessThan(1024 * 1024 + 50);
  });

  it('resolves with the child exit code on normal exit', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = runGit(['show', 'HEAD'], CWD);
    child.stdout.emit('data', Buffer.from('hello'));
    child.emit('exit', 0);
    const result = await p;
    expect(result).toEqual({ stdout: 'hello', stderr: '', code: 0 });
  });
});
