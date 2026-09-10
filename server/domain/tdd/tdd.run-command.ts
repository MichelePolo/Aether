import type { CommandResult } from './tdd.types';

interface ShellResult {
  isError: boolean;
  exitCode?: number;
  content: Array<{ type: 'text'; text: string }>;
}
type ShellExec = (input: { cmd: string; cwd?: string; timeout?: number; signal?: AbortSignal }) => Promise<ShellResult>;

const MAX_TIMEOUT_MS = 120_000;

export function parseExitCode(text: string, isError: boolean): number {
  const match = /exit code:\s*(\d+)\s*$/.exec(text);
  const code = match ? Number(match[1]) : isError ? 1 : 0;
  return isError && code === 0 ? 1 : code;
}

/** Build a runCommand that executes via the shell handler and returns {exitCode, output}. */
export function createRunCommand(exec: ShellExec) {
  return async (command: string, cwd?: string, signal?: AbortSignal): Promise<CommandResult> => {
    const result = await exec({ cmd: command, cwd, timeout: MAX_TIMEOUT_MS, ...(signal ? { signal } : {}) });
    const output = result.content.map((c) => c.text).join('\n');
    return { exitCode: result.exitCode ?? parseExitCode(output, result.isError), output };
  };
}
