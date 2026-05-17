import { test, expect } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  // Slice 0: l'app legacy è ancora viva, quindi cerchiamo l'elemento esistente.
  // Slice 1+ aggiornerà questo selettore alla nuova UI.
  await expect(page).toHaveTitle(/AI Studio|Aether/i);
});
