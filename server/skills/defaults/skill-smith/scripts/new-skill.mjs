#!/usr/bin/env node
// Scaffold a skill directory from the bundled templates.
// Usage: node new-skill.mjs <slug> --dir <parent-directory> [--shape single|router|tool] [--force]
// Creates only the subdirectories the chosen shape needs. Prints the paths it wrote.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, '..', 'assets', 'templates');
const SHAPES = ['single', 'router', 'tool'];
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseArgs(argv) {
  const opts = { shape: 'single', force: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--shape') opts.shape = argv[++i];
    else if (a === '--force') opts.force = true;
    else rest.push(a);
  }
  opts.slug = rest[0];
  return opts;
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));

if (!opts.slug || !opts.dir) {
  process.stderr.write('usage: node new-skill.mjs <slug> --dir <parent-directory> [--shape single|router|tool] [--force]\n');
  process.exit(2);
}
if (!NAME_RE.test(opts.slug) || opts.slug.length > 64) {
  fail(`slug "${opts.slug}" must be 1-64 chars of lowercase a-z0-9 with single hyphens, no leading or trailing hyphen`);
}
if (!SHAPES.includes(opts.shape)) fail(`unknown shape "${opts.shape}" (expected ${SHAPES.join(', ')})`);
if (!existsSync(opts.dir)) fail(`parent directory does not exist: ${opts.dir}`);

const root = path.resolve(opts.dir, opts.slug);
if (existsSync(root) && readdirSync(root).length && !opts.force) {
  fail(`${root} already exists and is not empty — pass --force to write into it anyway`);
}

const title = opts.slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const written = [];

/** Shortest readable form: relative when the target is under cwd, absolute otherwise. */
function display(p) {
  const r = path.relative(process.cwd(), p);
  return !r || r.startsWith('..') ? p : r;
}

function write(relPath, contents) {
  const full = path.join(root, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
  written.push(display(full));
}

const template = (file) => readFileSync(path.join(TEMPLATES, file), 'utf8');

// Each shape gets the section that makes its bundled files reachable. A pointer
// states the condition for following it, not just the path — a bare link is one
// the model either skips or follows every time.
const SHAPE_SECTIONS = {
  single: '',
  router: `
## Which branch

Read only the row that matches the request; the others stay on disk.

| The user wants        | Read                             |
| --------------------- | -------------------------------- |
| {{BRANCH_A}}          | \`references/first-branch.md\`     |
`,
  tool: `
## Bundled script

Run this instead of doing the transformation by hand — it is deterministic and
costs no context:

\`\`\`bash
node scripts/run.mjs <arg>
\`\`\`

Prints {{WHAT_IT_PRINTS}}. A non-zero exit means {{WHAT_IT_MEANS}}.
`,
};

write('SKILL.md', template('SKILL.md.template')
  .replaceAll('{{SLUG}}', opts.slug)
  .replaceAll('{{TITLE}}', title)
  .replace('\n## Steps', `${SHAPE_SECTIONS[opts.shape]}\n## Steps`));

if (opts.shape === 'router') {
  write('references/first-branch.md', template('reference.md.template')
    .replaceAll('{{REFERENCE_TITLE}}', 'First branch'));
}

if (opts.shape === 'tool') {
  write('scripts/run.mjs', `#!/usr/bin/env node
// TODO: what this does, in one line.
// Usage: node run.mjs <arg>
// Prints <what>. Exits non-zero when <condition>.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve bundled files from the script's own location, never from process.cwd():
// a skill is invoked from unpredictable working directories.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const target = process.argv[2];
if (!target) {
  process.stderr.write('usage: node run.mjs <arg>\\n');
  process.exit(2);
}

process.stdout.write(\`TODO: implement, using \${HERE} for bundled paths\\n\`);
`);
}

process.stdout.write(`${written.map((w) => `  wrote ${w}`).join('\n')}\n\n`);
process.stdout.write(`Next:
  1. Fill in the frontmatter description — what it does AND when to use it, one line.
  2. Replace every {{PLACEHOLDER}} and delete the sections you did not use.
  3. node ${display(path.join(HERE, 'validate-skill.mjs'))} ${display(root)}
`);
