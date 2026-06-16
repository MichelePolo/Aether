import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSkillsRoutes } from './skills.routes';
import { SkillsService } from '@/server/domain/skills/skills.service';
import { SkillStateStore } from '@/server/domain/skills/skill-state.store';
import { makeTestDb } from '@/server/test/test-db';
import { isAppError } from '@/server/lib/errors';
import type { DatabaseHandle } from '@/server/db/database';

function makeSkill(root: string, slug: string, description: string): void {
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${description}\n---\n# ${slug}`);
}

let db: DatabaseHandle;
let dataDir: string;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  dataDir = mkdtempSync(path.join(tmpdir(), 'data-'));
  mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
  const service = new SkillsService(new SkillStateStore(db), dataDir);
  app = express();
  app.use(express.json());
  app.use('/api/skills', createSkillsRoutes(service));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });
});
afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('skills routes', () => {
  it('GET /api/skills returns skills + drafts', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const res = await request(app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body.skills[0]).toMatchObject({ name: 'alpha', enabled: false });
    expect(res.body.drafts).toEqual([]);
  });

  it('PATCH /api/skills/:slug/enabled toggles', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const res = await request(app).patch('/api/skills/alpha/enabled').send({ enabled: true });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/skills');
    expect(list.body.skills[0].enabled).toBe(true);
  });

  it('PATCH /api/skills/:slug/pinned toggles', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const res = await request(app).patch('/api/skills/alpha/pinned').send({ pinned: true });
    expect(res.status).toBe(200);
  });

  it('400 on invalid body', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const res = await request(app).patch('/api/skills/alpha/enabled').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('POST /api/skills/promote moves a draft', async () => {
    makeSkill(path.join(dataDir, 'skills', '.drafts'), 'wip', 'Work');
    const res = await request(app).post('/api/skills/promote').send({ slug: 'wip' });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/skills');
    expect(list.body.skills.map((s: { name: string }) => s.name)).toContain('wip');
  });

  it('DELETE /api/skills/:slug removes', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const res = await request(app).delete('/api/skills/alpha');
    expect(res.status).toBe(204);
  });
});
