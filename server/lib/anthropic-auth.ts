import { spawn } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';

type AuthMode = 'oauth' | 'apikey' | 'none';

// Windows è più lento al cold-start (lo shim `claude.cmd`/`.ps1` viene lanciato
// via cmd.exe) e in ufficio la rete passa spesso da un proxy: timeout più
// generosi evitano falsi 'none' al boot. Su altre piattaforme restano i valori
// stretti originali.
const isWindows = process.platform === 'win32';
const CLI_TIMEOUT_MS = isWindows ? 8_000 : 2_000;
const SDK_PROBE_TIMEOUT_MS = isWindows ? 12_000 : 5_000;

export async function detectAnthropicAuth(): Promise<AuthMode> {
  const cliOk = await checkClaudeCli();
  if (!cliOk) return 'none';

  if (typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.length > 0) {
    return 'apikey';
  }

  const probeOk = await probeOAuth();
  return probeOk ? 'oauth' : 'none';
}

function checkClaudeCli(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    // Su Windows `claude` è uno shim `.cmd`/`.ps1`: Node recente rifiuta di
    // eseguirlo senza shell, perciò spawn senza `shell:true` emetterebbe sempre
    // 'error' → falso 'none'. Comando e args sono costanti: nessun input utente,
    // quindi `shell:true` qui non introduce injection.
    const child = spawn('claude', ['--version'], isWindows ? { shell: true } : undefined);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(false);
    }, CLI_TIMEOUT_MS);

    child.on('exit', (code: number | null) => {
      clearTimeout(timer);
      finish(code === 0);
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

async function probeOAuth(): Promise<boolean> {
  const aborter = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      aborter.abort();
      resolve(false);
    }, SDK_PROBE_TIMEOUT_MS);
  });

  const iterationPromise = (async (): Promise<boolean> => {
    try {
      const iter = query({
        prompt: 'ping',
        options: {
          model: 'claude-haiku-4-5',
          maxTurns: 1,
          allowedTools: [],
          abortController: aborter,
        },
      } as Parameters<typeof query>[0]);
      for await (const ev of iter) {
        const msg = ev as { type?: string; error?: string };
        if (msg.type === 'assistant' && typeof msg.error === 'string') {
          return false;
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  })();

  try {
    return await Promise.race([iterationPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    aborter.abort();
  }
}
