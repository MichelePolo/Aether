#!/usr/bin/env node
// Validate a skill and zip it for upload or distribution.
// Usage: node package-skill.mjs <skill-dir> [--out <file.zip>] [--skip-validate]
// Writes a zip whose single top-level entry is <slug>/. Exits non-zero if the
// skill would be rejected on upload.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'evals', '__pycache__', '.venv']);
const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const isWorkspace = (name) => name.endsWith('-workspace');

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--'));
const outIdx = argv.indexOf('--out');
if (!target) {
  process.stderr.write('usage: node package-skill.mjs <skill-dir> [--out <file.zip>] [--skip-validate]\n');
  process.exit(2);
}

const root = path.resolve(target);
if (!existsSync(path.join(root, 'SKILL.md'))) fail(`no SKILL.md in ${root}`);
const slug = path.basename(root);
const out = outIdx !== -1 ? path.resolve(argv[outIdx + 1]) : path.resolve(root, '..', `${slug}.zip`);

if (!argv.includes('--skip-validate')) {
  const res = spawnSync(process.execPath, [path.join(HERE, 'validate-skill.mjs'), root], {
    encoding: 'utf8',
    windowsHide: true,
  });
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');
  if (res.status !== 0) {
    fail('the skill is not conformant — fix the errors above, or pass --skip-validate to package it anyway');
  }
}

/** Collect the files that belong in the package, as `<slug>/relative/path`. */
function collect(dir, prefix, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name) || isWorkspace(e.name)) continue;
      collect(path.join(dir, e.name), `${prefix}${e.name}/`, acc);
    } else if (!EXCLUDED_FILES.has(e.name) && !e.name.endsWith('.zip')) {
      acc.push({ name: `${prefix}${e.name}`, full: path.join(dir, e.name) });
    }
  }
  return acc;
}

const entries = collect(root, `${slug}/`);
if (!entries.length) fail('nothing to package');

// --- minimal zip writer (deflate, no external dependency) -------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time, as the zip format has stored them since 1980. */
function dosStamp(mtime) {
  const d = new Date(Math.max(mtime.getTime(), Date.UTC(1980, 0, 1)));
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = readFileSync(entry.full);
    const deflated = deflateRawSync(data);
    // Stored beats deflated when compression made it bigger (tiny files do this).
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const { time, date } = dosStamp(statSync(entry.full).mtime);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);          // version needed
    header.writeUInt16LE(0x0800, 6);      // flags: UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);          // extra field length
    local.push(header, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 30);              // extra + comment lengths
    cd.writeUInt16LE(0, 34);              // disk number start
    cd.writeUInt16LE(0, 36);              // internal attributes
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, 0644
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += header.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, eocd]);
}

// Emitted last: buildZip closes over `const` bindings declared above it.
writeFileSync(out, buildZip(entries));
const size = statSync(out).size;
process.stdout.write(`\nPackaged ${entries.length} file(s) into ${out} (${(size / 1024).toFixed(1)} KB)\n`);
process.stdout.write(`Top-level entry: ${slug}/\n`);
