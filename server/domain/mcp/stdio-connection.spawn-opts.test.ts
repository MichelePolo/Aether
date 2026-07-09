import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Asserts the spawn *options* (windowsHide) that the real-child tests in
// stdio-connection.test.ts cannot observe. Without windowsHide, every MCP
// server spawned by a detached daemon opens a console window on Windows.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { StdioMcpConnection } from './stdio-connection';

const spawnMock = vi.mocked(spawn);

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  child.kill = vi.fn();
  return child;
}

describe('StdioMcpConnection spawn options', () => {
  it('spawns the MCP server with windowsHide so no console window pops on Windows', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const conn = new StdioMcpConnection({ command: 'node', args: ['server.js'], env: {} });
    const init = conn.initialize();
    init.catch(() => {}); // handshake never completes against the fake child
    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      ['server.js'],
      expect.objectContaining({ windowsHide: true }),
    );
    await conn.close().catch(() => {});
  });
});
