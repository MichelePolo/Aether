import path from 'node:path';
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
  // PromptDialog stacks above ProfilesModal — scope by exact label to avoid sidebar "Rename" buttons
  const nameInput = page.getByLabel('Name', { exact: true });
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill('e2e profile');
  await page.getByRole('button', { name: /confirm/i }).click();

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

  // A new session row appears in the sidebar (default title = "Nuova sessione")
  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await expect(sidebar.getByRole('button', { name: /nuova sessione/i }).first()).toBeVisible({
    timeout: 5000,
  });
});

test('subagent: create + invoke + reasoning badge', async ({ page, request }) => {
  // wipe sub-agents
  const list = await request.get('/api/subagents').then((r) => r.json());
  for (const s of list.subAgents as { id: string }[]) {
    await request.delete(`/api/subagents/${s.id}`);
  }

  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  // Create a sub-agent via the sidebar
  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await sidebar.getByRole('button', { name: /new sub-agent/i }).click();

  // First prompt: name (single-line input). Use exact label to avoid sidebar "Rename" buttons.
  const namePrompt = page.getByRole('dialog').last();
  const nameInput = namePrompt.getByLabel('Name', { exact: true });
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill('designer');
  await namePrompt.getByRole('button', { name: /confirm/i }).click();

  // Second prompt: system instruction (multiline textarea). Scope to the dialog to avoid
  // colliding with the edit-modal textarea added in Slice 9.
  const sysPrompt = page.getByRole('dialog').last();
  const sysInput = sysPrompt.getByLabel('System instruction', { exact: true });
  await expect(sysInput).toBeVisible({ timeout: 5000 });
  await sysInput.fill('You are a designer.');
  await sysPrompt.getByRole('button', { name: /confirm/i }).click();

  // The sidebar should now show the new sub-agent
  await expect(sidebar.getByText('designer')).toBeVisible({ timeout: 5000 });

  // Send a message that mentions the sub-agent
  const ta = page.getByPlaceholder(/scrivi un messaggio/i);
  await ta.fill('@designer ping');
  await ta.press('Enter');

  // Wait for the reply
  await expect(page.getByText('pong').first()).toBeVisible({ timeout: 5000 });

  // Open the reasoning drawer via the per-message "Show reasoning" button (rendered when message has reasoningSteps)
  await page.getByRole('button', { name: /show reasoning/i }).last().click();
  const drawer = page.getByRole('complementary', { name: /reasoning/i });
  await expect(drawer.getByText(/sub-agent: designer/i)).toBeVisible({ timeout: 5000 });
});

test('mcp: connect mock server + live tool appears', async ({ page, request }) => {
  // Seed context with a mock MCP server entry. The existing context API exposes
  // bulkOverwrite (PUT /api/context); use it to add the mcpServer.
  const cur = await request.get('/api/context').then((r) => r.json());
  const seeded = {
    ...cur,
    mcpServers: [
      ...(cur.mcpServers ?? []).filter((s: { id: string }) => s.id !== 'E2E_MCP'),
      { id: 'E2E_MCP', name: 'mock', transport: 'mock', status: 'offline' },
    ],
  };
  await request.put('/api/context', { data: seeded });

  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  const sidebar = page.getByRole('complementary', { name: /sidebar/i });

  // Click the Connect button for the mock server
  await sidebar.getByRole('button', { name: /connect mock/i }).click();

  // The live tool 'mock.echo' should now appear in the sidebar
  await expect(sidebar.getByText('mock.echo')).toBeVisible({ timeout: 5000 });

  // Cleanup: disconnect so the test doesn't leak across runs
  await sidebar.getByRole('button', { name: /disconnect mock/i }).click();

  // Also remove the seeded entry from context (best-effort cleanup)
  const after = await request.get('/api/context').then((r) => r.json());
  const cleaned = {
    ...after,
    mcpServers: (after.mcpServers ?? []).filter((s: { id: string }) => s.id !== 'E2E_MCP'),
  };
  await request.put('/api/context', { data: cleaned });
});

test('provider: selector lists Fake; switching persists across new session', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  // Selector is visible
  const selector = page.getByRole('combobox', { name: /active provider/i });
  await expect(selector).toBeVisible();

  // At minimum, fake:default should be available (E2E env sets AETHER_FAKE_PROVIDER=1 → default=fake:default)
  await expect(page.getByRole('option', { name: /fake/i })).toBeAttached();

  // Pick fake:default and verify it's the active value
  await selector.selectOption('fake:default');
  await expect(selector).toHaveValue('fake:default');

  // Create a new session via the sidebar
  await page.getByRole('button', { name: /new session/i }).click();

  // Send a message; FakeProvider replies with "pong"
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('ping');
  await input.press('Enter');
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });
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

test('subagent edit: open modal, rename + add skill', async ({ page, request }) => {
  // Wipe all existing sub-agents so name collisions from prior tests don't cause strict-mode errors
  const existing = await request.get('/api/subagents').then((r) => r.json());
  for (const s of (existing.subAgents ?? []) as { id: string }[]) {
    await request.delete(`/api/subagents/${s.id}`);
  }

  // Seed a sub-agent via the API
  const created = await request.post('/api/subagents', {
    data: { name: 'designer' },
  }).then((r) => r.json()) as { id: string };

  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  // Sidebar shows the sub-agent
  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await expect(sidebar.getByText('designer', { exact: true })).toBeVisible();

  // Click the row → modal opens
  await sidebar.getByText('designer', { exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();

  // Rename
  await modal.getByRole('button', { name: /rename/i }).click();
  const promptDialog = page.getByRole('dialog').last();
  const nameInput = promptDialog.getByLabel('Name', { exact: true });
  await nameInput.fill('sculptor');
  await promptDialog.getByRole('button', { name: /confirm/i }).click();

  // Modal title updates
  await expect(modal.getByText('sculptor')).toBeVisible({ timeout: 5000 });

  // Add skill
  await modal.getByRole('button', { name: /add skill/i }).click();
  const skillPromptDialog = page.getByRole('dialog').last();
  const skillInput = skillPromptDialog.getByLabel('Skill name', { exact: true });
  await skillInput.fill('clay');
  await skillPromptDialog.getByRole('button', { name: /confirm/i }).click();

  // Skill row appears in the modal
  await expect(modal.getByText('clay')).toBeVisible({ timeout: 5000 });

  // Cleanup
  await request.delete(`/api/subagents/${created.id}`).catch(() => {});
});

test('mcp advanced: refresh button against mock MCP', async ({ page, request }) => {
  // Seed a mock server entry
  const cur = (await request.get('/api/context').then((r) => r.json())) as {
    mcpServers?: Array<{ id: string }>;
  };
  const seeded = {
    ...cur,
    mcpServers: [
      ...(cur.mcpServers ?? []).filter((s) => s.id !== 'E2E_ADV'),
      { id: 'E2E_ADV', name: 'mock', transport: 'mock', status: 'offline' },
    ],
  };
  await request.put('/api/context', { data: seeded });

  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  const sidebar = page.getByRole('complementary', { name: /sidebar/i });

  // Connect the mock server
  await sidebar.getByRole('button', { name: /connect mock/i }).click();
  await expect(sidebar.getByText('mock.echo')).toBeVisible({ timeout: 5000 });

  // Click Refresh — mock returns the same tools so mock.echo stays visible.
  await sidebar.getByRole('button', { name: /refresh mock/i }).click();
  await expect(sidebar.getByText('mock.echo')).toBeVisible();

  // Disconnect cleanup
  await sidebar.getByRole('button', { name: /disconnect mock/i }).click();

  // Cleanup seeded entry
  const after = (await request.get('/api/context').then((r) => r.json())) as {
    mcpServers?: Array<{ id: string }>;
  };
  const cleaned = {
    ...after,
    mcpServers: (after.mcpServers ?? []).filter((s) => s.id !== 'E2E_ADV'),
  };
  await request.put('/api/context', { data: cleaned });
});


test('session io: import session via palette creates a new session', async ({ page }) => {
  await page.goto('/');
  // Wait for the app shell
  await page.getByText('AETHER_CORE').waitFor();

  // Open the palette.
  await page.keyboard.press('Meta+K');
  await page.getByPlaceholder(/type a command/i).waitFor();

  // Run the import command — this triggers a click on the hidden input.
  await page.getByText('Import session…').click();

  // Programmatically attach the fixture file to the hidden input.
  const input = page.locator('input[type="file"][accept="application/json"]');
  await input.setInputFiles(
    path.resolve('e2e/fixtures/sample-session.json'),
  );

  // The imported session row should appear in the sidebar.
  await page.getByText('Playwright Imported Session').waitFor();
});

test('provider auth: pane is visible with 4 rows + refresh works', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  // Wait for the section header to render
  await page.getByText(/^Providers$/i).waitFor();
  const rows = page.getByTestId('provider-auth-row');
  await rows.first().waitFor();
  expect(await rows.count()).toBe(4);

  // Click refresh — rows still present
  await page.getByLabel('Refresh provider auth').click();
  await page.waitForTimeout(200);
  expect(await rows.count()).toBe(4);
});

test('key vault: open modal via palette, save a key, reopen shows masked', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  await page.keyboard.press('Meta+K');
  await page.getByText('Configure API keys…').click();

  await expect(page.getByTestId('key-vault-row')).toHaveCount(5);

  const openaiInput = page.getByLabel('OpenAI key');
  await openaiInput.fill('sk-e2e-test-key-67890');
  await page.getByRole('button', { name: /save openai/i }).click();

  await expect(page.getByText('sk-…7890')).toBeVisible({ timeout: 3000 });

  await page.getByRole('button', { name: /clear openai/i }).click();
  await page.getByRole('button', { name: /clear openai/i }).click();
  await expect(page.getByLabel('OpenAI key')).toBeVisible();
});

test('fork: send message, right-click → Branch from here', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('hello aether');
  await input.press('Enter');

  // Wait for FakeProvider reply
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });

  // Right-click the user bubble in the main chat area
  const userBubble = page.getByRole('main').getByText('hello aether');
  await userBubble.click({ button: 'right' });

  // Click "Branch from here"
  await page.getByText('Branch from here').click();

  // The forked session is now active and contains the user message
  await expect(page.getByRole('main').getByText('hello aether')).toBeVisible();
});

test('attachments: paperclip → pick file → chip → send', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);

  // Set the hidden file input directly (paperclip would open the picker)
  const fileInput = page.locator('input[type="file"][accept*="image"]');
  await fileInput.setInputFiles(path.resolve('e2e/fixtures/tiny.png'));

  // Chip appears
  await expect(page.getByText('tiny.png').first()).toBeVisible({ timeout: 3000 });

  // Send
  await input.fill('look');
  await input.press('Enter');

  // Wait for FakeProvider reply — round trip completed, attachment persisted
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });

  // The chip is cleared on `done` (queue reset). Persisted-render-after-dispatch
  // requires a hydration roundtrip — exercised by reopening the session.
  await expect(page.getByText('tiny.png').first()).not.toBeVisible({ timeout: 2000 });
});

test('builtin MCPs: 3 toggle rows visible, click Filesystem twice to toggle on/off', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  const rows = page.getByTestId('builtin-mcp-row');
  await expect(rows).toHaveCount(3);

  await page.getByLabel('Toggle Filesystem').click();
  await page.waitForTimeout(500);

  await page.getByLabel('Toggle Filesystem').click();
  await page.waitForTimeout(500);

  await expect(rows).toHaveCount(3);
});

test('breakpoints: sidebar shows 3 rows + toggling dangerous flips its mode', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  await expect(page.getByText('Breakpoints')).toBeVisible();
  const rows = page.getByTestId('breakpoint-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('gate');

  await page.getByLabel('Toggle Dangerous mode').click();
  await expect(rows.nth(1)).toContainText('auto', { timeout: 3000 });

  // Flip back so this test leaves no side effects on the shared dev server.
  await page.getByLabel('Toggle Dangerous mode').click();
  await expect(rows.nth(1)).toContainText('gate', { timeout: 3000 });
});

test('workspaces: Add modal opens with browse entries', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  // The Workspaces section header should be visible
  await expect(page.getByText(/^Workspaces$/)).toBeVisible();

  // Open the modal
  await page.getByRole('button', { name: /add workspace/i }).click();

  // Modal: "Add this folder" button visible.
  await expect(page.getByText('Add this folder')).toBeVisible({ timeout: 3000 });

  // Cancel out.
  await page.getByRole('button', { name: /^cancel$/i }).click();
});
