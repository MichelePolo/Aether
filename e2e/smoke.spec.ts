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
