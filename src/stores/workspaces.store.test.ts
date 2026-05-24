import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspacesStore } from './workspaces.store';

describe('useWorkspacesStore', () => {
  beforeEach(() => {
    useWorkspacesStore.getState()._reset();
  });

  it('init() populates from server (default [])', async () => {
    await useWorkspacesStore.getState().init();
    expect(useWorkspacesStore.getState().workspaces).toEqual([]);
  });

  it('create() appends to the local list', async () => {
    await useWorkspacesStore.getState().init();
    await useWorkspacesStore.getState().create({ name: 'p', rootPath: '/tmp/p' });
    expect(useWorkspacesStore.getState().workspaces).toHaveLength(1);
    expect(useWorkspacesStore.getState().workspaces[0].name).toBe('p');
  });

  it('rename() updates the local row', async () => {
    await useWorkspacesStore.getState().init();
    const w = await useWorkspacesStore.getState().create({ name: 'a', rootPath: '/tmp/a' });
    await useWorkspacesStore.getState().rename(w.id, 'b');
    expect(useWorkspacesStore.getState().workspaces[0].name).toBe('b');
  });

  it('remove() removes locally even on missing id', async () => {
    await useWorkspacesStore.getState().init();
    const w = await useWorkspacesStore.getState().create({ name: 'a', rootPath: '/tmp/a' });
    await useWorkspacesStore.getState().remove(w.id);
    expect(useWorkspacesStore.getState().workspaces).toEqual([]);
  });

  it('init() failure surfaces in error', async () => {
    const orig = global.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = (() => Promise.resolve(new Response('', { status: 500 }))) as any;
    await useWorkspacesStore.getState().init();
    expect(useWorkspacesStore.getState().error).toBeTruthy();
    expect(useWorkspacesStore.getState().loading).toBe(false);
    global.fetch = orig;
  });
});
