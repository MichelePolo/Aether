import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Asserts the spawn *options* (windowsHide) that the real-shell tests in
// aether-shell.handler.test.ts cannot observe.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { executeCommand } from './aether-shell.handler';

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

describe('executeCommand spawn options', () => {
  it('spawns the shell with windowsHide so no console window pops on Windows', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = executeCommand({ cmd: 'echo hi' });
    child.emit('exit', 0);
    await p;
    expect(spawnMock).toHaveBeenCalledWith(
      'echo hi',
      [],
      expect.objectContaining({ shell: true, windowsHide: true }),
    );
  });
});
