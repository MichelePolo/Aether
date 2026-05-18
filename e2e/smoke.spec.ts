import { test, expect } from '@playwright/test';

test('app shell loads with new sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();
  await expect(page.getByText('System Protocol')).toBeVisible();
  await expect(page.getByText('Active Skills')).toBeVisible();
  await expect(page.getByText('Tool Registry')).toBeVisible();
  await expect(page.getByText('MCP Network')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
});

test('toggle sidebar hides the panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();
  await page.getByRole('button', { name: /toggle sidebar/i }).click();
  await expect(page.getByText('AETHER_CORE')).not.toBeVisible();
});

test('chat: send message and receive FakeProvider reply', async ({ page, request }) => {
  // clean state for determinism (FakeProvider sessions are persisted to disk)
  await request.delete('/api/sessions/default');
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('ping');
  await input.press('Enter');
  // user message visible
  await expect(page.getByText('ping')).toBeVisible();
  // FakeProvider emette ['pong'] con 50ms di delay
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });
  // Send button torna visibile a fine streaming
  await expect(page.getByRole('button', { name: /send/i })).toBeVisible({ timeout: 5000 });
});
