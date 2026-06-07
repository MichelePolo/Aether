import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// A deterministic temp git repo (main + feature branch + no-ff merge with a PR
// subject + tag + a follow-up commit) that the History view will visualize.
let repoDir: string;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'E2E',
  GIT_AUTHOR_EMAIL: 'e2e@aether.dev',
  GIT_COMMITTER_NAME: 'E2E',
  GIT_COMMITTER_EMAIL: 'e2e@aether.dev',
};

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, ...GIT_ENV } });
}

test.beforeAll(() => {
  repoDir = mkdtempSync(path.join(tmpdir(), 'aether-git-e2e-'));
  git(repoDir, 'init', '-q');
  // Deterministic default branch name regardless of init.defaultBranch.
  git(repoDir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(path.join(repoDir, 'a.txt'), 'A1\n');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-q', '-m', 'first commit on main');

  git(repoDir, 'checkout', '-q', '-b', 'feature/login');
  writeFileSync(path.join(repoDir, 'login.ts'), 'export const login = 1\n');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-q', '-m', 'add login');

  git(repoDir, 'checkout', '-q', 'main');
  git(repoDir, 'merge', '--no-ff', 'feature/login', '-m', 'Merge pull request #7 from feature/login');
  git(repoDir, 'tag', 'v1');

  writeFileSync(path.join(repoDir, 'a.txt'), 'A2\n');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-q', '-m', 'update a on main');
});

test.afterAll(() => {
  if (repoDir) rmSync(repoDir, { recursive: true, force: true });
});

// Clean server-side sessions and workspaces each test so a single fresh session
// is active and the temp-repo workspace can be (re)created without colliding
// with the rootPath UNIQUE constraint.
test.beforeEach(async ({ request, page }) => {
  const res = await request.get('/api/sessions');
  if (res.ok()) {
    const body = (await res.json()) as { sessions: Array<{ id: string }> };
    for (const s of body.sessions) await request.delete(`/api/sessions/${s.id}`);
  }
  const wsRes = await request.get('/api/workspaces');
  if (wsRes.ok()) {
    const body = (await wsRes.json()) as { workspaces: Array<{ id: string }> };
    for (const w of body.workspaces) await request.delete(`/api/workspaces/${w.id}`);
  }
  // Default to the chat view; the fresh context starts with empty localStorage,
  // but we keep aether.activeSessionId intact across the reload below so the
  // session we attach the workspace to stays active.
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('aether.mainView');
    } catch {
      // ignore
    }
  });
});

// Boots the app, attaches the temp repo workspace to the active session, and
// switches to the History view.
async function listSessions(request: APIRequestContext) {
  const r = await request.get('/api/sessions');
  if (!r.ok()) return [];
  const b = (await r.json()) as { sessions: Array<{ id: string; workspaceId?: string }> };
  return b.sessions;
}

async function openHistory(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  // The session the view will read after reload is the one init() persisted as
  // active. Poll localStorage because init() persists it asynchronously.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('aether.activeSessionId')), {
      timeout: 10_000,
    })
    .not.toBeNull();
  const sessionId = await page.evaluate(() => localStorage.getItem('aether.activeSessionId'));

  const wsRes = await request.post('/api/workspaces', {
    data: { name: 'git-e2e', rootPath: repoDir },
  });
  expect(wsRes.ok()).toBeTruthy();
  const ws = (await wsRes.json()) as { id: string };

  const pres = await request.patch(`/api/sessions/${sessionId}`, {
    data: { workspaceId: ws.id },
  });
  expect(pres.ok()).toBeTruthy();

  // Confirm the attachment landed on THAT session (match by id; listSessions is
  // ordered by updated_at so positional indexing is not reliable).
  await expect
    .poll(
      async () => (await listSessions(request)).find((s) => s.id === sessionId)?.workspaceId ?? null,
      { timeout: 5_000 },
    )
    .toBe(ws.id);

  // Reload so the sessions store hydrates the session's workspaceId; the
  // persisted aether.activeSessionId keeps this session active.
  await page.reload();
  const toggle = page.getByRole('button', { name: /open git history/i });
  await toggle.waitFor({ timeout: 10_000 });
  await toggle.click();
}

test('git history: renders swimlanes with branch lanes, a merge and an inferred PR', async ({
  page,
  request,
}) => {
  await openHistory(page, request);

  // The dedicated view title.
  await expect(page.getByText('History', { exact: true })).toBeVisible({ timeout: 5000 });

  // Commit subjects from the fixture are rendered.
  await expect(page.getByText('update a on main')).toBeVisible();
  await expect(page.getByText('Merge pull request #7 from feature/login')).toBeVisible();

  // The lane legend exposes the feature branch (unique name → unambiguous).
  await expect(page.getByText('feature/login').first()).toBeVisible();

  // The merge commit carries an inferred PR badge.
  await expect(page.getByText('PR #7').first()).toBeVisible();
});

test('git history: expand a commit and open a file diff', async ({ page, request }) => {
  await openHistory(page, request);

  // Expand the newest commit (it modified a.txt).
  await page.getByText('update a on main').click();

  // Its file accordion exposes a.txt as a diff affordance.
  const fileBtn = page.getByRole('button', { name: /view diff for a\.txt/i });
  await expect(fileBtn).toBeVisible({ timeout: 5000 });
  await fileBtn.click();

  // The diff dialog opens and shows real unified-diff content.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await expect(dialog.getByText(/a\.txt/).first()).toBeVisible();
  // The change from A1 -> A2 produces an added line in the diff.
  await expect(dialog.getByText(/A2/).first()).toBeVisible({ timeout: 5000 });
});

test('git history: empty state when the session has no workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  await page.getByRole('button', { name: /open git history/i }).click();

  // No workspace attached → the no-workspace empty state.
  await expect(page.getByText(/no workspace/i).first()).toBeVisible({ timeout: 5000 });
});
