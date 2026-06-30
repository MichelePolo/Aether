import { rmSync } from 'node:fs';
for (const target of ['dist', 'server.js', 'coverage', 'playwright-report']) {
  rmSync(target, { recursive: true, force: true });
}
