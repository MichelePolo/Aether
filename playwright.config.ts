import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

// Scratch data dir, unique per run, isolates from the developer's data/sessions.json
const E2E_DATA_DIR = path.join(os.tmpdir(), `aether-e2e-${Date.now()}`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      AETHER_FAKE_PROVIDER: '1',
      AETHER_DATA_DIR: E2E_DATA_DIR,
    },
  },
});
