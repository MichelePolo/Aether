import { parseArgs } from './args';
import { resolveEndpoint } from './config';
import { createSession, dispatch, rejectDecision } from './client';
import { handleEvent } from './output';
import { startDaemon, stopDaemon, statusDaemon } from './daemon';
import { defaultDeps } from './runtime';
import { openBrowser } from './open';

const writer = {
  out: (s: string) => process.stdout.write(s),
  err: (s: string) => process.stderr.write(s),
};

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function helpText(): string {
  return [
    'aether — headless CLI for the Aether daemon',
    '',
    'Usage:',
    '  aether daemon start [--open] | stop | status | restart',
    '  aether [--provider P] [--session ID] [--port N] [--json] "<prompt>"',
    '  cat file | aether "<prompt>"',
    '',
  ].join('\n');
}

async function runPrompt(
  prompt: string,
  flags: ReturnType<typeof parseArgs>['flags'],
): Promise<number> {
  const ep = resolveEndpoint({ port: flags.port });
  const deps = defaultDeps({ port: flags.port });
  if (!(await deps.health(ep.baseUrl))) {
    writer.err(`aether: daemon not reachable at ${ep.baseUrl}. Run \`aether daemon start\`.\n`);
    return 3;
  }

  const piped = await readStdin();
  const message = piped ? `${prompt}\n\n\`\`\`\n${piped}\n\`\`\`` : prompt;

  const sessionId = flags.session ?? (await createSession(ep.baseUrl));
  if (!flags.session) writer.err(`aether: session ${sessionId}\n`);

  let exitCode = 0;
  let finished = false;
  await dispatch({
    baseUrl: ep.baseUrl,
    sessionId,
    message,
    providerName: flags.provider,
    onEvent: (ev) => {
      if (ev.event === 'tool_call_request') {
        const callId = (ev.data as { callId?: string })?.callId;
        if (callId) void rejectDecision(ep.baseUrl, callId);
      }
      const r = handleEvent(ev, { json: flags.json }, writer);
      if (r.done) {
        finished = true;
        if (r.error) exitCode = 1;
      }
    },
  });
  if (!finished) exitCode = 1;
  return exitCode;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'help') {
    writer.out(helpText());
    return 0;
  }

  if (args.command === 'daemon') {
    const deps = defaultDeps({ port: args.flags.port });
    switch (args.daemonAction) {
      case 'start': {
        const r = await startDaemon(deps);
        writer.out(
          r.already
            ? `already running on port ${r.port}\n`
            : `started (pid ${r.pid}) on port ${r.port}\n`,
        );
        if (args.flags.open) {
          const url = `http://127.0.0.1:${r.port}`;
          writer.out(`opening ${url}\n`);
          openBrowser(url);
        }
        return 0;
      }
      case 'stop': {
        const stopped = await stopDaemon(deps);
        writer.out(stopped ? 'stopped\n' : 'not running\n');
        return 0;
      }
      case 'restart': {
        await stopDaemon(deps);
        await deps.sleep(500);
        const r = await startDaemon(deps);
        writer.out(`restarted on port ${r.port}\n`);
        return 0;
      }
      case 'status':
      default: {
        const s = await statusDaemon(deps);
        writer.out(s.running ? `running (pid ${s.pid}) on port ${s.port}\n` : 'stopped\n');
        return 0;
      }
    }
  }

  return runPrompt(args.prompt ?? '', args.flags);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`aether: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
