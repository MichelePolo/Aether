import { describe, it, expect, vi } from 'vitest';
import { addSkillFlow, addToolFlow, addMcpFlow } from './addFlows';

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
  it('chains name → url', async () => {
    const dialog = makeDialog(['srv', 'http://x']);
    const add = vi.fn().mockResolvedValue(undefined);
    await addMcpFlow(dialog as never, add);
    expect(add).toHaveBeenCalledWith({ name: 'srv', url: 'http://x', status: 'connecting' });
  });

  it('aborts if url cancelled', async () => {
    const dialog = makeDialog(['srv', null]);
    const add = vi.fn();
    await addMcpFlow(dialog as never, add);
    expect(add).not.toHaveBeenCalled();
  });
});
