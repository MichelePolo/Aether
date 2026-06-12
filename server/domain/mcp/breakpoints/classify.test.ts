import { describe, it, expect } from 'vitest';
import { classifyTool } from './classify';

describe('classifyTool', () => {
  it('classifies file-write tools as dangerous via name regex', () => {
    expect(classifyTool({ qualifiedName: 'fs.write_file', args: {} }).category).toBe('dangerous');
    expect(classifyTool({ qualifiedName: 'fs.delete_file', args: {} }).category).toBe('dangerous');
    expect(classifyTool({ qualifiedName: 'db.drop_table', args: {} }).category).toBe('dangerous');
  });

  it('classifies execute_command as dangerous', () => {
    const r = classifyTool({ qualifiedName: 'shell.execute_command', args: { cmd: 'echo hi' } });
    expect(r.category).toBe('dangerous');
    expect(r.source).toBe('heuristic');
  });

  it('classifies git_push / git_rebase / git_reset as dangerous', () => {
    expect(classifyTool({ qualifiedName: 'git.git_push', args: {} }).category).toBe('dangerous');
    expect(classifyTool({ qualifiedName: 'git.git_rebase', args: {} }).category).toBe('dangerous');
  });

  it('classifies read-only tools as safe by default', () => {
    expect(classifyTool({ qualifiedName: 'fs.read_file', args: {} }).category).toBe('safe');
    expect(classifyTool({ qualifiedName: 'fs.list_directory', args: {} }).category).toBe('safe');
  });

  it('honors explicit override.category over heuristic', () => {
    const r = classifyTool({
      qualifiedName: 'fs.read_file',
      args: {},
      override: { category: 'dangerous' },
    });
    expect(r.category).toBe('dangerous');
    expect(r.source).toBe('override');
  });

  it('heuristic never assigns external; only override can', () => {
    const r = classifyTool({
      qualifiedName: 'api.fetch_url',
      args: {},
      override: { category: 'external' },
    });
    expect(r.category).toBe('external');
    expect(r.source).toBe('override');

    const r2 = classifyTool({ qualifiedName: 'api.fetch_url', args: {} });
    expect(r2.category).toBe('safe');
  });
});

describe('classifyTool — git tools (slice 28)', () => {
  for (const name of ['Git.git_add', 'Git.git_commit', 'Git.git_checkout', 'Git.git_restore']) {
    it(`classifies ${name} as dangerous`, () => {
      expect(classifyTool({ qualifiedName: name, args: {} }).category).toBe('dangerous');
    });
  }
  for (const name of ['Git.git_status', 'Git.git_diff']) {
    it(`classifies ${name} as safe`, () => {
      expect(classifyTool({ qualifiedName: name, args: {} }).category).toBe('safe');
    });
  }
});

describe('classifyTool — git remote tools (slice 29)', () => {
  for (const name of ['Git.git_push', 'Git.git_pull', 'Git.git_merge']) {
    it(`classifies ${name} as dangerous`, () => {
      expect(classifyTool({ qualifiedName: name, args: {} }).category).toBe('dangerous');
    });
  }
  it('classifies Git.git_fetch as safe (read-only remote)', () => {
    expect(classifyTool({ qualifiedName: 'Git.git_fetch', args: {} }).category).toBe('safe');
  });
});
