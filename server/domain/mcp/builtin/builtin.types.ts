export type BuiltinTransport = 'filesystem' | 'terminal' | 'git';

export interface BuiltinMcpState {
  transport: BuiltinTransport;
  enabled: boolean;
  fsRoot: string | null;
}

export interface BuiltinMcpListResponse {
  builtins: BuiltinMcpState[];
}

export const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/(?!\w)/,
  /\bsudo\b/,
  /:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;\s*:/,
  /\bdd\s+if=/,
  /\bmkfs\./,
  /\s>\s*\/dev\/sd[a-z]/,
  /\bchmod\s+-R\s+777\s+\//,
];

export const SHELL_DEFAULTS = {
  timeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  outputCapBytes: 1 * 1024 * 1024,
} as const;
