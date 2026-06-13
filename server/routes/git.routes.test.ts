import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import { GitService } from '@/server/domain/git/git.service';
import { createApp } from '@/server/app';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
  });
}

let repoDir: string;
let app: Express;

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'git-routes-repo-'));

  git(['init', '-q'], repoDir);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test User'], repoDir);
  git(['config', 'commit.gpgsign', 'false'], repoDir);

  writeFileSync(join(repoDir, 'a.txt'), 'A1\n');
  git(['add', 'a.txt'], repoDir);
  git(['commit', '-q', '-m', 'A1'], repoDir);

  writeFileSync(join(repoDir, 'a.txt'), 'A2\n');
  git(['add', 'a.txt'], repoDir);
  git(['commit', '-q', '-m', 'A2'], repoDir);

  const store = {
    get: (id: string) =>
      id === 'ws1' ? { id, name: 'r', rootPath: repoDir, addedAt: 0 } : undefined,
  } as unknown as WorkspacesStore;

  const gitService = new GitService(store);
  app = createApp({ gitService });
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('GET /api/git/status', () => {
  it('returns 200 with isRepo true for a real repo', async () => {
    const res = await request(app).get('/api/git/status').query({ workspaceId: 'ws1' });
    expect(res.status).toBe(200);
    expect(res.body.isRepo).toBe(true);
    expect(typeof res.body.head).toBe('string');
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await request(app).get('/api/git/status');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown workspace', async () => {
    const res = await request(app).get('/api/git/status').query({ workspaceId: 'missing' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/git/log', () => {
  it('returns 200 with a non-empty commits array', async () => {
    const res = await request(app).get('/api/git/log').query({ workspaceId: 'ws1' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.commits)).toBe(true);
    expect(res.body.commits.length).toBeGreaterThan(0);
    expect(typeof res.body.truncated).toBe('boolean');
  });

  it('respects maxCount and reports truncated', async () => {
    const res = await request(app)
      .get('/api/git/log')
      .query({ workspaceId: 'ws1', maxCount: '1' });
    expect(res.status).toBe(200);
    expect(res.body.commits.length).toBe(1);
    expect(res.body.truncated).toBe(true);
  });
});

describe('GET /api/git/diff', () => {
  it('returns 200 text/plain with a non-empty unified diff', async () => {
    const log = await request(app).get('/api/git/log').query({ workspaceId: 'ws1' });
    const commit = log.body.commits.find(
      (c: { files: { path: string }[] }) => c.files.some((f) => f.path === 'a.txt'),
    );
    expect(commit).toBeDefined();
    const hash = (commit as { hash: string }).hash.slice(0, 12);

    const res = await request(app)
      .get('/api/git/diff')
      .query({ workspaceId: 'ws1', hash, path: 'a.txt' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('returns 400 for an invalid hash (service ValidationError)', async () => {
    const res = await request(app)
      .get('/api/git/diff')
      .query({ workspaceId: 'ws1', hash: 'zzz', path: 'a.txt' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when path is missing', async () => {
    const res = await request(app)
      .get('/api/git/diff')
      .query({ workspaceId: 'ws1', hash: 'abcdef0' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('git routes — changes pane', () => {
  // Reuses the existing `app` (createApp with a real GitService over repoDir
  // exposed as workspace 'ws1').
  it('GET /api/git/changes returns structured working changes', async () => {
    writeFileSync(join(repoDir, 'a.txt'), 'CHANGED\n');
    const res = await request(app).get('/api/git/changes').query({ workspaceId: 'ws1' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.unstaged)).toBe(true);
  });

  it('POST /api/git/stage then /commit works; missing fields → 400', async () => {
    writeFileSync(join(repoDir, 'b.txt'), 'B\n');
    const stage = await request(app)
      .post('/api/git/stage')
      .send({ workspaceId: 'ws1', paths: ['b.txt'] });
    expect(stage.status).toBe(204);
    const commit = await request(app)
      .post('/api/git/commit')
      .send({ workspaceId: 'ws1', message: 'b' });
    expect(commit.status).toBe(200);
    expect(commit.body.head).toMatch(/^[0-9a-f]{7,}$/);
    const bad = await request(app).post('/api/git/stage').send({ workspaceId: 'ws1' });
    expect(bad.status).toBe(400);
  });

  it('GET /api/git/working-diff returns text/plain', async () => {
    writeFileSync(join(repoDir, 'a.txt'), 'CHANGED2\n');
    const res = await request(app)
      .get('/api/git/working-diff')
      .query({ workspaceId: 'ws1', path: 'a.txt' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });
});
