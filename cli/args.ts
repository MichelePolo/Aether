export interface CliFlags {
  json: boolean;
  provider?: string;
  session?: string;
  port?: number;
}

export interface ParsedArgs {
  command: 'daemon' | 'run' | 'help';
  daemonAction?: string;
  prompt?: string;
  flags: CliFlags;
}

const VALUE_FLAGS = new Set(['--provider', '--session', '--port']);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: CliFlags = { json: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (arg === '--provider') flags.provider = value;
      else if (arg === '--session') flags.session = value;
      else if (arg === '--port') flags.port = parseInt(value, 10);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length === 0) return { command: 'help', flags };
  if (positionals[0] === 'daemon') {
    return { command: 'daemon', daemonAction: positionals[1] ?? 'status', flags };
  }
  return { command: 'run', prompt: positionals.join(' '), flags };
}
