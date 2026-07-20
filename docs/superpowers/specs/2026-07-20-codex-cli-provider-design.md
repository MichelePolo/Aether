# Spec — Provider Codex CLI (abbonamento ChatGPT)

- **Data:** 2026-07-20
- **Progetto:** Aether (`aether-core`) — server TS + frontend React/Vite
- **Stato:** design approvato in brainstorming (3 decisioni, vedi §3)
- **Obiettivo utente:** usare **Codex CLI** (già installato e loggato con l'abbonamento ChatGPT)
  come provider di dispatch, senza API key OpenAI — come già avviene per Anthropic tramite il
  binario `claude` (slice 11).

## 1. Obiettivo

Aggiungere il transport **`codex`**: un provider che spawna `codex exec --json` e mappa il suo
stream di eventi JSONL sul contratto `AIProvider` esistente. L'auth non passa mai da Aether:
il CLI legge da solo le credenziali in `$CODEX_HOME` (`~/.codex/auth.json`). Il loop agentico
gira **dentro** Codex (come per Anthropic via Agent SDK): i tool MCP di Aether gli vengono
esposti tramite un **bridge MCP streamable-HTTP su loopback** e ogni chiamata rientra in
`req.runToolCall` → gate breakpoints, tracing e SSE invariati.

Verificato su **codex-cli 0.144.1** (macchina dell'utente): `exec --json` emette
`thread.started`, `turn.started`, item (`agent_message`, `agent_reasoning`,
`command_execution`, …), `turn.completed`/`turn.failed`; `codex mcp add --url` supporta server
streamable-HTTP; `--ephemeral` e `--ignore-user-config` isolano la config mantenendo l'auth.

## 2. Vincoli (dal contesto e dal codice)

- **Nessuna regressione sui provider esistenti**; il ramo OAuth Anthropic
  (`detectAnthropicAuth → resolveAuthEnv → claude`) non viene toccato. Modifiche ai file
  condivisi (`registry.ts`, `auth-status.types.ts`) solo additive (nuova variante di union).
- **Auth mai gestita da Aether**: niente KeyVault, niente env var da iniettare. Detection =
  binario presente + login attivo.
- **Cross-platform**: ogni nuovo spawn site richiede `windowsHide: true` (regola 0.1.24);
  risoluzione del binario tollerante a `codex.cmd`/`codex.exe` su Windows (pattern
  `claude-code-executable.ts`).
- Convenzioni Aether: composition root in `server/index.ts`; provider in
  `server/domain/dispatch/providers/`; route factory `createXxxRoutes()`; lint = `tsc --noEmit`;
  test colocati; coverage ≥ 80% su `server/domain|lib`. Nessuna migration necessaria.

## 3. Decisioni approvate (brainstorming 2026-07-20)

1. **Tool bridge = HTTP loopback.** Aether espone un endpoint MCP streamable-HTTP su
   `127.0.0.1:<PORT>` con **token opaco per-dispatch**; passato a Codex via
   `-c mcp_servers.aether.url=...`. Nessun processo helper.
2. **Shell nativa = sandbox `read-only`.** La shell interna di Codex non è disattivabile;
   con `-s read-only` può solo leggere. Le scritture passano necessariamente dai tool Aether
   (gated). Limite accettato: le *letture* via shell nativa bypassano gate e tracing.
3. **Modelli = lista hardcoded + default da `~/.codex/config.toml`.** `codexHardcodedModels()`
   in `discovery.ts` (slug correnti da verificare in implementazione) più il `model` della
   config utente se non già in lista (es. `gpt-5.6-sol`).

## 4. Architettura

### 4.1 Provider — `server/domain/dispatch/providers/codex.provider.ts` (NUOVO)

- `CodexProvider implements AIProvider`; `capabilities = { thinking: true, toolCalling: true,
  vision: true }`.
- `stream()` spawna (con `windowsHide: true`):

  ```
  codex exec --json --ephemeral --skip-git-repo-check \
    -s read-only -m <model> --ignore-user-config \
    -c mcp_servers.aether.url="http://127.0.0.1:<port>/api/mcp-bridge/<token>" \
    - (prompt su stdin)
  ```

- Prompt = `renderConversation()`-style flatten della history (stesso approccio di
  `anthropic.provider.ts`): history → transcript testuale + `pendingAssistantText` per il resume.
- Parser JSONL riga-per-riga (tollerante: righe non-JSON o tipi ignoti → skip):
  - item `agent_message` → chunk `text`
  - item `agent_reasoning` → chunk `thinking` (solo se `req.thinking`)
  - `turn.completed` → chunk `done` con usage (input/output tokens se presenti)
  - `turn.failed` / `error` → `throw` con il `message` dell'evento (es. rate limit ChatGPT,
    testo già user-friendly)
  - `tool_use`/MCP: **non** emette `function_call` — le tool call arrivano via bridge (§4.2)
- Abort: `signal` → kill del processo figlio (SIGTERM, poi SIGKILL dopo grace); stderr
  bufferizzato e accodato all'errore (pattern `stderrBuf` di anthropic.provider).
- Attachments immagine: scritti su file temporanei e passati con `-i` (cleanup in `finally`);
  attachment testuali sono già inlined a monte dal dispatch.

### 4.2 Bridge MCP — `server/domain/mcp/bridge/` (NUOVO) + route

- `bridge.service.ts`: registro in-memory `token → { tools: ProviderToolDecl[], runToolCall }`.
  `register()` chiamato dal provider prima dello spawn (token = `crypto.randomUUID()`),
  `unregister()` nel `finally`. TTL di sicurezza 25h (oltre il timeout gate 24h).
- `mcp-bridge.routes.ts`: `POST /api/mcp-bridge/:token` — JSON-RPC minimale:
  `initialize` → capabilities `{ tools: {} }`; `tools/list` → declarations registrate;
  `tools/call` → `runToolCall()` → `{ content: [{type:'text', …}], isError }`.
  Risposta JSON semplice (lo streamable-HTTP ammette risposte non-SSE). Token ignoto → 404.
- Sicurezza: endpoint utile solo su loopback; il token per-dispatch è l'autorizzazione.
  Montato in `createApp` solo se il servizio è presente (pattern `AppDeps` opzionali).

### 4.3 Auth/detection — `server/lib/codex-auth.ts` (NUOVO)

- `resolveCodexBinary()`: PATH + estensioni Windows (pattern `claude-code-executable.ts`).
- `detectCodexAuth(): Promise<'oauth' | 'none'>`: binario presente **e** `~/.codex/auth.json`
  esistente (niente probe di rete; `codex login status` come fallback opzionale).

### 4.4 Registry e status — MODIFICHE additive

- `registry.ts`: `ProviderTransport` += `'codex'`; deps += `detectCodexAuth`, `codexBuilder`;
  blocco `// Codex` in `refresh()` con entry `codex:<model>`; display `Codex CLI / <model>`.
  `defaultName()`: **in coda** (mai default automatico, come openai-compat).
- `discovery.ts`: `codexHardcodedModels()` + `readCodexDefaultModel()` (parse leggero di
  `~/.codex/config.toml`, riga `model = "…"`; niente dipendenza TOML).
- `auth-status.types.ts`: `TRANSPORT_ORDER` += `'codex'`; `auth-status.ts`: `probeCodex()` →
  `ok/oauth` o `unconfigured/not logged in`. Badge in sidebar gratis (pane providers generico).

## 5. Limitazioni accettate / fuori scope

- Letture via shell nativa Codex fuori da gate/tracing (mitigate da `read-only` + istruzione
  nel system prompt di preferire i tool Aether).
- Streaming per-item (blocchi più grossi rispetto ad Anthropic), niente delta per-token.
- Niente toggle sandbox in UI (rimandato); niente supporto `codex mcp-server`/app-server.
- Rate limit ChatGPT: mappato come errore leggibile, nessuna retry logic.

## 6. Rischi

- **Formato eventi versionato**: `exec --json` può cambiare tra release del CLI → parser
  tollerante + fixture JSONL nei test; slug modello verificati in implementazione.
- **Porta/bind**: l'URL del bridge deve usare la porta effettiva del server (da bootstrap),
  non hardcoded 3000.
