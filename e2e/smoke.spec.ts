import { test, expect } from '@playwright/test';

// Wipe all server-side sessions so each test starts from a clean slate.
// The dev server is reused across tests, and the scratch AETHER_DATA_DIR is
// shared for the whole run, so without this hook sessions accumulate between
// tests and selectors become ambiguous.
test.beforeEach(async ({ page, request }) => {
  const res = await request.get('/api/sessions');
  if (res.ok()) {
    const body = (await res.json()) as { sessions: Array<{ id: string }> };
    for (const s of body.sessions) {
      await request.delete(`/api/sessions/${s.id}`);
    }
  }
  // Also wipe the persisted active-session id from localStorage so init()
  // creates a fresh session on page load.
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('aether.activeSessionId');
    } catch {
      // ignore
    }
  });
});

test('app shell loads with new sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();
  await expect(page.getByText('Sessions')).toBeVisible();
  await expect(page.getByText('System Protocol')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
});

test('toggle sidebar hides the panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();
  await page.getByRole('button', { name: /toggle sidebar/i }).click();
  await expect(page.getByText('AETHER_CORE')).not.toBeVisible();
});

test('chat: send message and receive FakeProvider reply', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('ping');
  await input.press('Enter');
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: /send/i })).toBeVisible({ timeout: 5000 });
});

test('chat: creating a second session shows it as active', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);

  // First session: send "first" and wait for streaming to fully complete.
  // The textarea is disabled while streaming; waiting for it to re-enable is
  // the most reliable "streaming done" signal (the Send button uses
  // `disabled={!value.trim()}`, so it stays disabled after the input clears).
  await input.fill('first');
  await input.press('Enter');
  await expect(page.getByText('pong').first()).toBeVisible({ timeout: 5000 });
  await expect(input).toBeEnabled({ timeout: 5000 });

  // Open a new session — this now switches active because streaming is done.
  await page.getByRole('button', { name: /new session/i }).click();
  await expect(input).toBeEnabled();
  // Wait for the chat hydration to settle (new session has no messages).
  // Otherwise a late `hydrate([])` resolving after we send "second" would
  // wipe the pending user message from the local chat store.
  await expect(page.getByRole('main').getByText('pong')).toHaveCount(0);

  // Send "second" in the new (empty) session.
  await input.fill('second');
  await input.press('Enter');
  await expect(page.getByText('pong').first()).toBeVisible({ timeout: 5000 });
  await expect(input).toBeEnabled({ timeout: 5000 });

  // SessionsSection should now show two session rows. Scope to the sidebar
  // and use exact matching so the row's main button doesn't collide with
  // the per-row "Rename <title>" / "Delete <title>" buttons.
  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await expect(sidebar.getByRole('button', { name: 'first', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'second', exact: true })).toBeVisible();
});

test('chat: delete a session removes it from the list', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('to-delete');
  await input.press('Enter');
  await expect(page.getByText('pong').first()).toBeVisible({ timeout: 5000 });
  // Wait for streaming to fully complete so the session-row title has
  // settled to "to-delete" (textarea is disabled while streaming).
  await expect(input).toBeEnabled({ timeout: 5000 });

  // Hover the session row in the sidebar to reveal action buttons. Use
  // exact matching so we don't collide with "Rename to-delete" / "Delete
  // to-delete" buttons that share the title.
  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  const row = sidebar.getByRole('button', { name: 'to-delete', exact: true });
  await expect(row).toBeVisible();
  await row.hover();

  // Click the delete button (aria-label="Delete to-delete"). The button is
  // hidden by `group-hover:flex` until the row container is hovered. Force
  // the click defensively to avoid flakiness around CSS hover-state
  // propagation in Playwright.
  await sidebar.getByRole('button', { name: /delete to-delete/i }).click({ force: true });

  // Confirm dialog — scope to the dialog so the regex can't match other UI.
  await page.getByRole('dialog').getByRole('button', { name: /confirm/i }).click();

  // The session row should be gone from the sidebar.
  await expect(sidebar.getByRole('button', { name: 'to-delete', exact: true })).toHaveCount(0);
});

test('profiles: save → apply roundtrip', async ({ page, request }) => {
  // clean profile state
  const list = await request.get('/api/profiles').then((r) => r.json());
  for (const p of list.profiles as { id: string }[]) {
    await request.delete(`/api/profiles/${p.id}`);
  }
  await page.addInitScript(() => {
    localStorage.removeItem('aether.activeProfileId');
  });

  await page.goto('/');

  // Open Profiles modal
  await page.getByRole('button', { name: /open profiles manager/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Save current as new
  await dialog.getByRole('button', { name: /save current as new/i }).click();
  // PromptDialog appears (a second dialog on top)
  const promptDialog = page.getByRole('dialog').last();
  await promptDialog.getByRole('textbox').fill('e2e profile');
  await promptDialog.getByRole('button', { name: /ok|save|confirm/i }).last().click();

  // Row visible in table
  await expect(page.getByText('e2e profile')).toBeVisible({ timeout: 5000 });

  // Apply
  await page.getByRole('button', { name: /^apply$/i }).first().click();

  // TopBar button now shows the profile name
  await expect(page.getByRole('button', { name: /open profiles manager/i })).toContainText(
    'e2e profile',
  );
});

test('palette: ⌘K → new session via palette', async ({ page, request }) => {
  // wipe sessions
  const list = await request.get('/api/sessions').then((r) => r.json());
  for (const s of list.sessions as { id: string }[]) {
    await request.delete(`/api/sessions/${s.id}`);
  }
  await page.addInitScript(() => {
    localStorage.removeItem('aether.activeSessionId');
  });

  await page.goto('/');
  // Allow init() to settle
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  // Open palette via Cmd+K
  await page.keyboard.press('Meta+K');
  const input = page.getByPlaceholder(/type a command/i);
  await expect(input).toBeVisible({ timeout: 5000 });

  await input.fill('new session');
  await page.keyboard.press('Enter');

  // Palette closes
  await expect(input).toHaveCount(0, { timeout: 5000 });

  // A new session row appears in the sidebar
  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await expect(sidebar.getByRole('button', { name: /untitled/i }).first()).toBeVisible({
    timeout: 5000,
  });
});

test('reasoning: thinking on emits steps + opens drawer', async ({ page, request }) => {
  // clean session state for determinism
  const list = await request.get('/api/sessions').then((r) => r.json());
  for (const s of (list.sessions as { id: string }[])) {
    await request.delete(`/api/sessions/${s.id}`);
  }
  await page.addInitScript(() => {
    localStorage.removeItem('aether.activeSessionId');
  });

  await page.goto('/');
  // enable thinking
  await page.getByRole('button', { name: /toggle thinking/i }).click();

  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('think');
  await input.press('Enter');

  // drawer auto-opens on first thinking chunk
  await expect(page.getByRole('complementary', { name: /reasoning/i })).toBeVisible({ timeout: 5000 });
  // at least one reasoning step card appears (any of context/dispatch/validation badges)
  await expect(page.getByText(/context|dispatch|validation/i).first()).toBeVisible({ timeout: 5000 });
});
