#!/usr/bin/env node
// Test stand-in for the codex binary. Modes:
//   fake-codex.cjs emit <fixture.jsonl>  → drain stdin, replay fixture lines, exit 0
//   fake-codex.cjs hang <fixture.jsonl>  → print first line, then stay alive (abort tests)
//   fake-codex.cjs fail                  → write to stderr, exit 1
const fs = require('fs');

const mode = process.argv[2];
const fixture = process.argv[3];

process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', main);

function main() {
  if (mode === 'fail') {
    process.stderr.write('boom: auth expired\n');
    process.exit(1);
  }
  const lines = fs.readFileSync(fixture, 'utf8').split('\n').filter(Boolean);
  if (mode === 'hang') {
    process.stdout.write(lines[0] + '\n');
    setInterval(() => {}, 1000);
    return;
  }
  for (const line of lines) process.stdout.write(line + '\n');
  process.exit(0);
}
