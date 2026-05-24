import { describe, it, expect } from 'vitest';
import { workspacesApi } from './workspaces.api';

describe('workspacesApi (against MSW defaults)', () => {
  it('list returns []', async () => {
    expect(await workspacesApi.list()).toEqual([]);
  });

  it('create returns the created row', async () => {
    const w = await workspacesApi.create({ name: 'p', rootPath: '/tmp/p' });
    expect(w.name).toBe('p');
    expect(w.rootPath).toBe('/tmp/p');
  });

  it('rename returns the updated row', async () => {
    const w = await workspacesApi.rename('w1', 'renamed');
    expect(w.name).toBe('renamed');
  });

  it('remove resolves with no body', async () => {
    await expect(workspacesApi.remove('w1')).resolves.toBeUndefined();
  });

  it('browse returns entries', async () => {
    const r = await workspacesApi.browse('/tmp');
    expect(Array.isArray(r)).toBe(true);
  });

  it('activateForSession returns rooted', async () => {
    const r = await workspacesApi.activateForSession('s1');
    expect(r).toHaveProperty('rooted');
  });
});
