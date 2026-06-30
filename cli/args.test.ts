import { describe, it, expect } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs', () => {
  it('parses a bare prompt as the run command', () => {
    const r = parseArgs(['explain this error']);
    expect(r).toMatchObject({ command: 'run', prompt: 'explain this error' });
  });

  it('parses daemon subcommands', () => {
    expect(parseArgs(['daemon', 'start'])).toMatchObject({
      command: 'daemon',
      daemonAction: 'start',
    });
  });

  it('collects global flags', () => {
    const r = parseArgs(['--json', '--provider', 'anthropic:claude-opus-4-7', '--session', 's1', 'hi']);
    expect(r.command).toBe('run');
    expect(r.prompt).toBe('hi');
    expect(r.flags).toMatchObject({
      json: true,
      provider: 'anthropic:claude-opus-4-7',
      session: 's1',
    });
  });

  it('parses --port as a number', () => {
    expect(parseArgs(['--port', '4100', 'hi']).flags.port).toBe(4100);
  });

  it('treats no args as the help command', () => {
    expect(parseArgs([]).command).toBe('help');
  });

  it('daemon with no action defaults to status', () => {
    const r = parseArgs(['daemon']);
    expect(r).toMatchObject({ command: 'daemon', daemonAction: 'status' });
  });

  it('parses --open as a boolean flag', () => {
    const a = parseArgs(['daemon', 'start', '--open']);
    expect(a.command).toBe('daemon');
    expect(a.daemonAction).toBe('start');
    expect(a.flags.open).toBe(true);
  });

  it('defaults open to false', () => {
    expect(parseArgs(['daemon', 'status']).flags.open).toBe(false);
  });
});
