import { build as esbuildBuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rmSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const p = (...s) => join(root, ...s);

async function run() {
  // 1. SPA — vite empties dist/ (emptyOutDir default) then writes the client build.
  await viteBuild();

  // 2. Server / CLI / builtin-MCP bundles (esbuild JS API), written into dist/.
  await esbuildBuild({
    entryPoints: ['server/index.ts'],
    bundle: true, platform: 'node', format: 'cjs',
    packages: 'external', sourcemap: true,
    outfile: 'dist/server.cjs',
    banner: { js: "const import_meta_url=require('url').pathToFileURL(__filename).href" },
    define: { 'import.meta.url': 'import_meta_url' },
  });
  await esbuildBuild({
    entryPoints: ['server/mcp/builtin/aether-shell.ts'],
    bundle: true, platform: 'node', format: 'esm',
    outfile: 'dist/server/mcp/builtin/aether-shell.js',
  });
  await esbuildBuild({
    entryPoints: ['server/mcp/builtin/aether-git.ts'],
    bundle: true, platform: 'node', format: 'esm',
    outfile: 'dist/server/mcp/builtin/aether-git.js',
  });
  await esbuildBuild({
    entryPoints: ['cli/index.ts'],
    bundle: true, platform: 'node', format: 'cjs',
    packages: 'external', sourcemap: true,
    outfile: 'dist/cli.cjs',
    banner: { js: '#!/usr/bin/env node' },
  });

  // 3. Runtime assets the bundles read at runtime (no shell: node:fs only).
  rmSync(p('dist/db/migrations'), { recursive: true, force: true });
  mkdirSync(p('dist/db'), { recursive: true });
  cpSync(p('server/db/migrations'), p('dist/db/migrations'), { recursive: true });

  rmSync(p('dist/skills'), { recursive: true, force: true });
  mkdirSync(p('dist/skills'), { recursive: true });
  cpSync(p('server/skills/defaults'), p('dist/skills/defaults'), { recursive: true });
}

run().catch((err) => { console.error(err); process.exit(1); });
