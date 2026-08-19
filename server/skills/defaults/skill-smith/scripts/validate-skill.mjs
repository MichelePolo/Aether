#!/usr/bin/env node
// Mechanical conformance check for a skill directory.
// Usage: node validate-skill.mjs <skill-dir> [--json]
// Exits 0 when there are no errors (warnings are allowed), 1 otherwise.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const SPEC_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REF_PREFIXES = ['references/', 'scripts/', 'assets/'];
const IGNORED = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db']);
const ABSOLUTE_PATH_RE = /(^|[\s"'(=`])(\/(?:home|Users|usr|var|opt|tmp|etc)\/|[A-Za-z]:\\)/;

const findings = [];
const add = (level, file, message) => findings.push({ level, file, message });
const error = (file, message) => add('error', file, message);
const warn = (file, message) => add('warn', file, message);

function main(argv) {
  const json = argv.includes('--json');
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) {
    process.stderr.write('usage: node validate-skill.mjs <skill-dir> [--json]\n');
    return 2;
  }
  const dir = path.resolve(target);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write(`error: not a directory: ${dir}\n`);
    return 2;
  }

  const slug = path.basename(dir);
  const skillMd = path.join(dir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    error('SKILL.md', 'missing — every skill directory needs a SKILL.md at its root');
    return report(findings, json, dir);
  }

  const raw = readFileSync(skillMd, 'utf8');
  const { fields, unknown, bodyStart, ok } = parseFrontmatter(raw);
  if (!ok) {
    error('SKILL.md', 'no well-formed YAML frontmatter — the file must open with a `---` line and close with another');
    return report(findings, json, dir);
  }

  checkName(fields, slug);
  checkDescription(fields);
  checkOptionalFields(fields, unknown);
  checkBody(raw, bodyStart);

  const files = walk(dir, dir);
  const markdown = files.filter((f) => f.endsWith('.md'));
  const mentions = collectMentions(dir, markdown);
  checkLinks(dir, markdown);
  checkReachability(dir, files, mentions);
  checkReferenceSizes(dir, files);
  checkEmptyDirs(dir, dir);
  checkAbsolutePaths(dir, markdown);

  return report(findings, json, dir);
}

/** Minimal YAML frontmatter reader: top-level scalars plus one nested map level. */
function parseFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { ok: false };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { ok: false };

  const fields = {};
  const unknown = [];
  let current = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indented = /^\s/.test(line);
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = unquote(line.slice(sep + 1).trim());
    if (indented && current) {
      fields[current][key] = value;
      continue;
    }
    if (!SPEC_FIELDS.includes(key)) unknown.push(key);
    if (value === '') {
      fields[key] = {};
      current = key;
    } else {
      fields[key] = value;
      current = null;
    }
  }
  return { fields, unknown, bodyStart: end + 1, ok: true };
}

function unquote(s) {
  const q = s.at(0);
  return s.length >= 2 && (q === '"' || q === "'") && s.at(-1) === q ? s.slice(1, -1) : s;
}

function checkName(fields, slug) {
  const name = fields.name;
  if (typeof name !== 'string' || !name) {
    error('SKILL.md', 'frontmatter `name` is required');
    return;
  }
  if (name.length > 64) error('SKILL.md', `name is ${name.length} chars (max 64)`);
  if (!NAME_RE.test(name)) {
    error('SKILL.md', `name "${name}" must be lowercase a-z0-9 and single hyphens, with no leading or trailing hyphen`);
  }
  if (name !== slug) error('SKILL.md', `name "${name}" must match the directory name "${slug}"`);
}

function checkDescription(fields) {
  const d = fields.description;
  if (typeof d !== 'string' || !d) {
    error('SKILL.md', 'frontmatter `description` is required and must be a single-line scalar (folded `>-` and literal `|` blocks are not read by every host)');
    return;
  }
  if (d.length > 1024) error('SKILL.md', `description is ${d.length} chars (max 1024)`);
  else if (d.length > 700) warn('SKILL.md', `description is ${d.length} chars — aim for 200-500; long descriptions are truncated in some listings`);
  if (d.length < 40) warn('SKILL.md', 'description is very short — state what the skill does AND when to use it');
  if (!/\b(use|when|whenever|trigger|after|before)\b/i.test(d)) {
    warn('SKILL.md', 'description names no triggering situation — add "Use when ..." with the phrases a user would actually type');
  }
}

function checkOptionalFields(fields, unknown) {
  if (unknown.length) {
    warn('SKILL.md', `non-spec frontmatter key(s): ${unknown.join(', ')} — host extensions are rejected by claude.ai uploads and the Skills API (allowed: ${SPEC_FIELDS.join(', ')})`);
  }
  if (typeof fields.compatibility === 'string' && fields.compatibility.length > 500) {
    error('SKILL.md', `compatibility is ${fields.compatibility.length} chars (max 500)`);
  }
  const meta = fields.metadata;
  if (meta && typeof meta === 'object') {
    for (const k of ['name', 'description']) {
      if (k in meta) error('SKILL.md', `metadata.${k} shadows a top-level field — line-based frontmatter parsers will read it as the skill's own ${k}`);
    }
  }
}

function checkBody(raw, bodyStart) {
  const body = raw.split(/\r?\n/).slice(bodyStart);
  const lines = body.length;
  if (!body.join('').trim()) {
    error('SKILL.md', 'body is empty — the frontmatter alone tells the model nothing about how to do the job');
    return;
  }
  if (lines > 500) error('SKILL.md', `body is ${lines} lines (max 500) — split at a decision boundary into references/`);
  else if (lines > 300) warn('SKILL.md', `body is ${lines} lines — look for a decision boundary to split before it reaches 500`);
}

function walk(root, dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, full, acc);
    else acc.push(rel(root, full));
  }
  return acc;
}

const rel = (root, full) => path.relative(root, full).split(path.sep).join('/');

/** Every path-looking token in every markdown file, code fences included. */
function collectMentions(dir, markdown) {
  const mentions = new Set();
  const re = new RegExp(`(?:${REF_PREFIXES.join('|')})[\\w./-]*`, 'g');
  for (const f of markdown) {
    for (const m of readFileSync(path.join(dir, f), 'utf8').matchAll(re)) {
      mentions.add(m[0].replace(/[.,)]+$/, ''));
    }
  }
  return mentions;
}

/** Markdown links and backticked paths OUTSIDE code fences must resolve. */
function checkLinks(dir, markdown) {
  const backtick = new RegExp(`\`((?:${REF_PREFIXES.join('|')})[\\w./-]+)\``, 'g');
  for (const f of markdown) {
    const text = stripFences(readFileSync(path.join(dir, f), 'utf8'));
    const targets = new Set();
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const t = m[1].trim();
      if (/^(https?:|mailto:|#)/.test(t)) continue;
      targets.add(t.split('#')[0]);
    }
    for (const m of text.matchAll(backtick)) targets.add(m[1]);
    for (const t of targets) {
      if (!t || t.endsWith('/')) continue;
      // The spec writes relative paths from the SKILL ROOT; tolerate
      // file-relative ones too, since both read naturally inside references/.
      const fromRoot = path.resolve(dir, t);
      const fromFile = path.resolve(path.dirname(path.join(dir, f)), t);
      const resolved = existsSync(fromRoot) ? fromRoot : fromFile;
      if (!existsSync(resolved)) error(f, `broken relative link: ${t} (resolved from the skill root)`);
      else if (path.relative(dir, resolved).startsWith('..')) error(f, `link escapes the skill directory: ${t}`);
    }
  }
}

function stripFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '').replace(/<!--[\s\S]*?-->/g, '');
}

function checkReachability(dir, files, mentions) {
  for (const f of files) {
    if (f === 'SKILL.md') continue;
    const reachable = mentions.has(f) || ancestors(f).some((a) => mentions.has(a) || mentions.has(`${a}/`));
    if (!reachable) warn(f, 'orphan — no markdown file points at it, so it will never be read; reference it from SKILL.md or delete it');
  }
}

const ancestors = (f) => {
  const parts = f.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
};

function checkReferenceSizes(dir, files) {
  for (const f of files.filter((x) => x.startsWith('references/') && x.endsWith('.md'))) {
    const lines = readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).length;
    if (lines > 300 && !/^##+\s+(contents|table of contents)/im.test(readFileSync(path.join(dir, f), 'utf8'))) {
      warn(f, `${lines} lines with no table of contents — add one so the model can seek instead of reading linearly`);
    }
    if (lines < 30) warn(f, `only ${lines} lines — small enough to fold back into SKILL.md and drop the indirection`);
  }
}

function checkEmptyDirs(root, dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || IGNORED.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (walk(root, full).length === 0) warn(rel(root, full), 'empty directory — remove it; it promises resources the skill does not have');
    else checkEmptyDirs(root, full);
  }
}

function checkAbsolutePaths(dir, markdown) {
  for (const f of markdown) {
    const lines = stripFences(readFileSync(path.join(dir, f), 'utf8')).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (ABSOLUTE_PATH_RE.test(line)) {
        error(f, `line ${i + 1}: absolute path — it breaks as soon as the skill is copied, installed, or packaged`);
      }
    });
  }
}

function report(findings, json, dir) {
  const errors = findings.filter((f) => f.level === 'error');
  if (json) {
    process.stdout.write(`${JSON.stringify({ dir, findings, ok: errors.length === 0 }, null, 2)}\n`);
    return errors.length ? 1 : 0;
  }
  const width = Math.max(0, ...findings.map((f) => f.file.length));
  for (const f of [...errors, ...findings.filter((x) => x.level === 'warn')]) {
    const stream = f.level === 'error' ? process.stderr : process.stdout;
    stream.write(`${f.level.toUpperCase().padEnd(5)} ${f.file.padEnd(width)}  ${f.message}\n`);
  }
  const warns = findings.length - errors.length;
  process.stdout.write(
    errors.length
      ? `\n${errors.length} error(s), ${warns} warning(s) — not conformant.\n`
      : `\nConformant: 0 errors, ${warns} warning(s). Structure only — judge the content with references/review-checklist.md.\n`,
  );
  return errors.length ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
