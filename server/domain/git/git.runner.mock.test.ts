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

describe('runGit (mocked spawn) — slice 29 opts', () => {
  it('opts.maxTimeoutMs raises the clamp above the local 30s default', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = runGit(['fetch'], CWD, { timeoutMs: 60_000, maxTimeoutMs: 120_000 });
    p.catch(() => {});
    // At 31s the local-default clamp (30s) would already have fired; it must NOT.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(child.kill).not.toHaveBeenCalled();
    // It fires at the raised 60s ceiling.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(p).rejects.toThrow(/timed out/);
  });

  it('opts.env is merged into the spawn environment', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = runGit(['fetch'], CWD, { env: { GIT_TERMINAL_PROMPT: '0' } });
    child.emit('exit', 0);
    await p;
    const passedEnv = (spawnMock.mock.calls[0][2] as { env: Record<string, string> }).env;
    expect(passedEnv.GIT_TERMINAL_PROMPT).toBe('0');
  });
});
