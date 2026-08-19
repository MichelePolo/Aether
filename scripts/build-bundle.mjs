#!/usr/bin/env node
// Assemble the portable skill-smith bundle from its canonical sources.
//
//   node scripts/build-bundle.mjs           write bundle/skill-smith/
//   node scripts/build-bundle.mjs --check   fail if the committed bundle is stale
//   node scripts/build-bundle.mjs --zip     also package the skill for claude.ai / the Skills API
//
// The bundle is generated AND committed: generated so there is one source of
// truth, committed so it can be imported straight from a checkout without a
// build step. --check is what keeps the two honest.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(ROOT, ...s);

const SKILL_SRC = p('server', 'skills', 'defaults', 'skill-smith');
const SOURCES = p('bundle', 'sources');
const OUT = p('bundle', 'skill-smith');
const SKILL_IN_BUNDLE = 'skills/skill-smith';

/** path inside the bundle -> absolute source file */
function plan() {
  const files = new Map();
  for (const rel of walk(SKILL_SRC)) files.set(`${SKILL_IN_BUNDLE}/${rel}`, path.join(SKILL_SRC, rel));
  files.set('README.md', path.join(SOURCES, 'README.md'));
  files.set('.claude-plugin/plugin.json', path.join(SOURCES, 'plugin.json'));
  files.set('agents/skill-smith.md', path.join(SOURCES, 'agent.md'));
  // Codex reads its harness config from inside the skill directory, not beside it.
  files.set(`${SKILL_IN_BUNDLE}/agents/openai.yaml`, path.join(SOURCES, 'openai.yaml'));
  return files;
}

function walk(dir, prefix = '', acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === '.DS_Store') continue;
    if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`, acc);
    else acc.push(`${prefix}${e.name}`);
  }
  return acc;
}

function existingBundle() {
  if (!existsSync(OUT)) return new Set();
  return new Set(walk(OUT));
}

function check(files) {
  const onDisk = existingBundle();
  const problems = [];
  for (const [rel, src] of files) {
    if (!onDisk.has(rel)) problems.push(`missing:  ${rel}`);
    else if (!readFileSync(path.join(OUT, rel)).equals(readFileSync(src))) problems.push(`stale:    ${rel}`);
    onDisk.delete(rel);
  }
  for (const rel of onDisk) problems.push(`orphaned: ${rel}`);

  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\n\nThe committed bundle is out of sync with its sources. Run: npm run bundle\n`);
    return 1;
  }
  process.stdout.write(`bundle/skill-smith is in sync (${files.size} files).\n`);
  return 0;
}

function write(files) {
  rmSync(OUT, { recursive: true, force: true });
  for (const [rel, src] of files) {
    const dest = path.join(OUT, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src));
  }
  process.stdout.write(`Wrote ${files.size} files to ${path.relative(ROOT, OUT)}\n`);

  const validator = path.join(OUT, SKILL_IN_BUNDLE, 'scripts', 'validate-skill.mjs');
  const res = spawnSync(process.execPath, [validator, path.join(OUT, SKILL_IN_BUNDLE)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');
  return res.status === 0 ? 0 : 1;
}

function zip(files) {
  const outDir = p('dist', 'bundles');
  mkdirSync(outDir, { recursive: true });
  const packager = path.join(OUT, SKILL_IN_BUNDLE, 'scripts', 'package-skill.mjs');
  const res = spawnSync(
    process.execPath,
    [packager, path.join(OUT, SKILL_IN_BUNDLE), '--out', path.join(outDir, 'skill-smith.zip')],
    { encoding: 'utf8', windowsHide: true },
  );
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');
  return res.status === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
const files = plan();

if (!existsSync(SKILL_SRC)) {
  process.stderr.write(`error: canonical skill not found at ${SKILL_SRC}\n`);
  process.exit(2);
}

let status = argv.includes('--check') ? check(files) : write(files);
if (status === 0 && argv.includes('--zip')) status = zip(files);
process.exit(status);
