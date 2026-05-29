import type { CommandResult } from './tdd.types';

interface ShellResult {
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
}
type ShellExec = (input: { cmd: string; cwd?: string; timeout?: number }) => Promise<ShellResult>;

const MAX_TIMEOUT_MS = 120_000;

export function parseExitCode(text: string, isError: boolean): number {
  const m = text.match(/exit code:\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  return isError ? 1 : 0;
}

/** Build a runCommand that executes via the shell handler and returns {exitCode, output}. */
export function createRunCommand(exec: ShellExec) {
  return async (command: string, cwd?: string): Promise<CommandResult> => {
    const result = await exec({ cmd: command, cwd, timeout: MAX_TIMEOUT_MS });
    const output = result.content.map((c) => c.text).join('\n');
    return { exitCode: parseExitCode(output, result.isError), output };
  };
}
