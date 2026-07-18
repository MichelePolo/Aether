import { describe, it, expect, vi } from 'vitest';
import { addSkillFlow, addToolFlow, addMcpFlow, parseKeyValueLines } from './addFlows';

type Dialog = {
  prompt: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
};

function makeDialog(answers: Array<string | null | boolean>): Dialog {
  const queue = [...answers];
  return {
    prompt: vi.fn(async () => queue.shift() as string | null),
    confirm: vi.fn(async () => queue.shift() as boolean),
  };
}

describe('addSkillFlow', () => {
  it('calls addSkill with the name', async () => {
    const dialog = makeDialog(['my skill']);
    const addSkill = vi.fn().mockResolvedValue(undefined);
    await addSkillFlow(dialog as never, addSkill);
    expect(addSkill).toHaveBeenCalledWith('my skill');
  });

  it('aborts when cancelled', async () => {
    const dialog = makeDialog([null]);
    const addSkill = vi.fn();
    await addSkillFlow(dialog as never, addSkill);
    expect(addSkill).not.toHaveBeenCalled();
  });
});

describe('addToolFlow', () => {
  it('chains name → version → online confirm', async () => {
    const dialog = makeDialog(['tool', '2.0.0', true]);
    const addTool = vi.fn().mockResolvedValue(undefined);
    await addToolFlow(dialog as never, addTool);
    expect(addTool).toHaveBeenCalledWith({ name: 'tool', version: '2.0.0', status: 'online' });
  });

  it('falls back to offline when confirm=false', async () => {
    const dialog = makeDialog(['t', '1', false]);
    const addTool = vi.fn().mockResolvedValue(undefined);
    await addToolFlow(dialog as never, addTool);
    expect(addTool).toHaveBeenCalledWith({ name: 't', version: '1', status: 'offline' });
  });

  it('aborts if any prompt cancelled', async () => {
    const dialog = makeDialog(['t', null]);
    const addTool = vi.fn();
    await addToolFlow(dialog as never, addTool);
    expect(addTool).not.toHaveBeenCalled();
  });
});

describe('addMcpFlow', () => {
  it('http: chains name → transport → url → headers', async () => {
    const dialog = makeDialog(['srv', true, 'http://x', '']);
    const add = vi.fn().mockResolvedValue(undefined);
    await addMcpFlow(dialog as never, add);
    expect(add).toHaveBeenCalledWith({
      name: 'srv',
      transport: 'http',
      url: 'http://x',
      status: 'connecting',
    });
  });

  it('http: parses headers into a record', async () => {
    const dialog = makeDialog(['srv', true, 'http://x', 'Authorization: Bearer abc\nX-Ws: 1']);
    const add = vi.fn().mockResolvedValue(undefined);
    await addMcpFlow(dialog as never, add);
    expect(add).toHaveBeenCalledWith({
      name: 'srv',
      transport: 'http',
      url: 'http://x',
      headers: { Authorization: 'Bearer abc', 'X-Ws': '1' },
      status: 'connecting',
    });
  });

  it('stdio: chains name → transport → command → args → env', async () => {
    const dialog = makeDialog(['srv', false, 'npx', '-y\nsome-server\n', 'API_KEY=k']);
    const add = vi.fn().mockResolvedValue(undefined);
    await addMcpFlow(dialog as never, add);
    expect(add).toHaveBeenCalledWith({
      name: 'srv',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'some-server'],
      env: { API_KEY: 'k' },
      status: 'connecting',
    });
  });

  it('stdio: omits args/env when left empty', async () => {
    const dialog = makeDialog(['srv', false, 'my-server', '', '']);
    const add = vi.fn().mockResolvedValue(undefined);
    await addMcpFlow(dialog as never, add);
    expect(add).toHaveBeenCalledWith({
      name: 'srv',
      transport: 'stdio',
      command: 'my-server',
      status: 'connecting',
    });
  });

  it('aborts if url cancelled', async () => {
    const dialog = makeDialog(['srv', true, null]);
    const add = vi.fn();
    await addMcpFlow(dialog as never, add);
    expect(add).not.toHaveBeenCalled();
  });

  it('aborts if headers prompt cancelled', async () => {
    const dialog = makeDialog(['srv', true, 'http://x', null]);
    const add = vi.fn();
    await addMcpFlow(dialog as never, add);
    expect(add).not.toHaveBeenCalled();
  });

  it('aborts if command cancelled', async () => {
    const dialog = makeDialog(['srv', false, null]);
    const add = vi.fn();
    await addMcpFlow(dialog as never, add);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('parseKeyValueLines', () => {
  it('parses ":"-separated header lines, trimming whitespace', () => {
    expect(parseKeyValueLines('A: 1\n B :2', ':')).toEqual({ A: '1', B: '2' });
  });

  it('splits on the first separator only (Bearer tokens with colons survive)', () => {
    expect(parseKeyValueLines('Authorization: Bearer a:b:c', ':')).toEqual({
      Authorization: 'Bearer a:b:c',
    });
  });

  it('parses "="-separated env lines and skips malformed ones', () => {
    expect(parseKeyValueLines('A=1\nnope\n=x\nB=', '=')).toEqual({ A: '1', B: '' });
  });

  it('returns undefined for empty or all-malformed input', () => {
    expect(parseKeyValueLines('', ':')).toBeUndefined();
    expect(parseKeyValueLines('no-separator-here', ':')).toBeUndefined();
  });
});
