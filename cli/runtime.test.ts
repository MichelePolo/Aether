import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDeps } from './runtime';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('defaultDeps().serverEntry', () => {
  const origCwd = process.cwd();
  afterEach(() => process.chdir(origCwd));

  it('resolves the server bundle relative to the CLI module, not the cwd', () => {
    // Regression: serverEntry used path.resolve(process.cwd(), 'dist/server.cjs'),
    // so `aether daemon start` from any dir without a local dist/ spawned a
    // non-existent bundle -> "daemon did not become healthy".
    const fromHere = defaultDeps({}).serverEntry;
    process.chdir('/tmp');
    const fromTmp = defaultDeps({}).serverEntry;

    expect(fromTmp).toBe(fromHere);
    expect(path.isAbsolute(fromHere)).toBe(true);
    expect(path.basename(fromHere)).toBe('server.cjs');
    // The server bundle is a sibling of the CLI bundle (both live in dist/).
    expect(path.dirname(fromHere)).toBe(here);
  });
});
