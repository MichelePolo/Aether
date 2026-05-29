// Boots the built production bundle (dist/server.cjs) and verifies it serves
// GET /api/health. Exits 0 on success, 1 on failure (printing captured output).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.SMOKE_PORT || '3990';
const dataDir = mkdtempSync(join(tmpdir(), 'aether-smoke-'));
let output = '';

const child = spawn('node', ['dist/server.cjs'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    AETHER_FAKE_PROVIDER: '1',
    PORT,
    AETHER_DATA_DIR: dataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll() {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) break; // process died early
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
}

function cleanup() {
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

const ok = await poll();
cleanup();
if (ok) {
  console.log(`[smoke] dist/server.cjs healthy on :${PORT}`);
  process.exit(0);
} else {
  console.error('[smoke] dist/server.cjs did NOT become healthy. Captured output:\n' + output);
  process.exit(1);
}
