import type { SseEmitter } from '@/server/lib/sse';
import { createCollectingSse } from '@/server/lib/collecting-sse';
import type { TddRunnerDeps, TddRunOpts } from './tdd.types';

const TAIL_CHARS = 8000;

export function tail(output: string): string {
  if (output.length <= TAIL_CHARS) return output;
  return `…(truncated)\n${output.slice(-TAIL_CHARS)}`;
}

function framing(command: string, output: string): string {
  return [
    `The test command \`${command}\` is failing. Its output:`,
    '',
    '```',
    tail(output),
    '```',
    '',
    'Fix the code so the tests pass. Use your tools to read and edit the relevant files.',
    'Do not edit the tests unless they are clearly wrong.',
  ].join('\n');
}

export async function runTddLoop(
  deps: TddRunnerDeps,
  opts: TddRunOpts,
  sse: SseEmitter,
  signal: AbortSignal,
): Promise<void> {
  const maxRetries = opts.maxRetries ?? 5;

  const known = new Set((await deps.subAgentsStore.list()).map((s) => s.name));
  if (!known.has(opts.subAgentName)) {
    sse.event('tdd_error', { message: `unknown sub-agent: ${opts.subAgentName}` });
    sse.event('tdd_done', { status: 'error' });
    sse.end();
    return;
  }

  sse.event('tdd_started', { command: opts.command, subAgentName: opts.subAgentName, maxRetries });

  if (signal.aborted) {
    sse.event('tdd_done', { status: 'interrupted' });
    sse.end();
    return;
  }
  let res = await deps.runCommand(opts.command, opts.cwd);
  sse.event('tdd_test_result', {
    iteration: 0,
    exitCode: res.exitCode,
    passed: res.exitCode === 0,
    output: tail(res.output),
  });
  if (res.exitCode === 0) {
    sse.event('tdd_done', { status: 'already_green', iterations: 0 });
    sse.end();
    return;
  }

  const sessionId = await deps.createSession();

  for (let iteration = 1; iteration <= maxRetries; iteration++) {
    if (signal.aborted) {
      sse.event('tdd_done', { status: 'interrupted' });
      sse.end();
      return;
    }
    sse.event('tdd_iteration_started', { iteration });

    const collector = createCollectingSse(sse);
    await deps.dispatcher.handle(
      { sessionId, message: `@${opts.subAgentName} ${framing(opts.command, res.output)}` },
      collector,
      signal,
    );
    const turnError = collector.capturedError();
    if (turnError) {
      sse.event('tdd_error', { iteration, message: turnError.message });
      sse.event('tdd_done', { status: 'error' });
      sse.end();
      return;
    }

    res = await deps.runCommand(opts.command, opts.cwd);
    sse.event('tdd_test_result', {
      iteration,
      exitCode: res.exitCode,
      passed: res.exitCode === 0,
      output: tail(res.output),
    });
    if (res.exitCode === 0) {
      sse.event('tdd_done', { status: 'success', iterations: iteration });
      sse.end();
      return;
    }
  }

  sse.event('tdd_done', { status: 'max_retries_exceeded', iterations: maxRetries });
  sse.end();
}
