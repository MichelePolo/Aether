# Piano test e2e — matrice provider

Ogni test è dichiarato come produttoria sui provider disponibili. I provider
sono sempre 6 (salvo diversa indicazione):

| # | Provider | Trasporto | thinking | toolCalling | vision |
|---|----------|-----------|----------|-------------|--------|
| P1 | `fake:default` | FakeProvider | ✅ | ✅ | ❌ |
| P2 | `ollama:local:<modello>` | Ollama locale | ❌ | ✅ | ❌ |
| P3 | `ollama:<endpoint>:<modello>` | Ollama remoto | ❌ | ✅ | ❌ |
| P4 | `anthropic:claude-*` | Anthropic | ✅ | ✅ | ✅ |
| P5 | `gemini:gemini-*` | Gemini | ✅ | ✅ | ✅ |
| P6 | `openai:gpt-*` / `o3` | OpenAI | ✅/o3-only | ✅ | ✅ |

Legenda colonna **thinking**: `thinking=true` abilitato nel test.
Vincoli di capability segnalati con `—` (non applicabile).

**Esecuzione** (dettaglio in fondo, *Strategia di esecuzione & tag*):
- **PR CI** (`AETHER_FAKE_PROVIDER=1`): tutti i test provider-indipendenti + l'intera matrice su **P1 (Fake)**. Deterministico, gratis, veloce → tag `@ci`.
- **Nightly / manuale**: la matrice sui provider reali **P2–P6** → tag `@provider-matrix`, con skip automatico se mancano credenziali/endpoint.

---

## 1. Shell & navigazione (provider-indipendente)

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 1.1 | La app shell carica con sidebar, Sessions, System Protocol e `<main>` | — | — | — | — | — | — |
| 1.2 | Toggle sidebar nasconde/mostra il pannello | — | — | — | — | — | — |
| 1.3 | Comando palette ⌘K → nuova sessione | — | — | — | — | — | — |
| 1.4 | Comando palette ⌘K → importa sessione da file JSON | — | — | — | — | — | — |
| 1.5 | Comando palette ⌘K → configura chiavi API | — | — | — | — | — | — |

---

## 2. Chat base (send/receive)

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 2.1 | Invio messaggio → risposta testuale visibile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.2 | Invio messaggio → la textarea viene disabilitata durante lo streaming, poi riàabilitata | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.3 | Pulsante Send disabilitato quando input vuoto | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.4 | Multi-turno: due messaggi consecutivi nella stessa sessione producono cronologia | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.5 | Creazione seconda sessione → entrambe le righe visibili nella sidebar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.6 | Cancellazione sessione → riga rimossa dalla sidebar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.7 | Rinominare una sessione dalla sidebar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Note**: il FakeProvider risponde sempre "pong". Per P2–P6 occorre verificare
che la risposta sia una stringa non vuota, non un errore. Per il timeout di
streaming usare un valore adeguato (es. 30s su provider remoti).

---

## 3. Provider — selezione e persistenza

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 3.1 | La pill modello nel composer mostra tutti i provider abilitati (dropdown) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.2 | Cambiare provider attivo nel selettore → persiste nella sessione corrente | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.3 | Nuova sessione usa il provider di default (localStorage) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.4 | Provider auth: pannello visibile con righe per ogni trasporto | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.5 | Provider auth: pulsante refresh mantiene il numero di righe | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Note**: P1 sempre presente (`AETHER_FAKE_PROVIDER=1`). P2–P6 dipendono
dalle credenziali/config dell'ambiente e2e. In CI con `AETHER_FAKE_PROVIDER=1`
solo P1 è disponibile; i test 3.2–3.5 su P2–P6 richiedono un ambiente con
tutte le API key e Ollama attivo. Il selettore provider è ora la **pill modello
nel composer** (spostato dalla TopBar) — UX dettagliata in §18.

---

## 4. Key Vault

| # | Test | Note |
|---|------|------|
| 4.1 | Palette → Configura chiavi → 5 righe visibili (Gemini, OpenAI, Anthropic, Ollama host, Ollama token) | provider-indipendente |
| 4.2 | Inserire una chiave OpenAI → salva → riapre → mostra mascherata (`sk-…7890`) | provider-indipendente |
| 4.3 | Cancellare una chiave salvata → campo input riappare vuoto | provider-indipendente |

---

## 5. Allegati (attachments)

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 5.1 | Allegato testo (.txt) → inlined come code block nel messaggio → risposta ricevuta | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.2 | Allegato immagine (.png) → chip visibile → invio messaggio → risposta ricevuta | — | — | — | ✅ | ✅ | ✅ |
| 5.3 | Allegato immagine inviato a provider senza vision → errore atteso (400) | ✅ | ✅ | ✅ | — | — | — |
| 5.4 | Multipli allegati (3 file) → tutti compaiono come chip → invio → risposta | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.5 | Chip allegato cleared dopo il `done` dell'event stream | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.6 | MIME non supportato → errore 400 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.7 | Dimensione totale > 10 MB → errore 413 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Note**: FakeProvider ha `vision: false` di default → 5.2 fallisce su P1.
Per testare 5.2 su P1 si dovrebbe configurare FakeProvider con `vision: true`
tramite API di bootstrap (non fattibile via UI). In un ambiente e2e reale,
5.2 si testa solo su P4/P5/P6.

---

## 6. Pensiero (thinking / reasoning)

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 6.1 | Toggle thinking ON → invio messaggio → reasoning drawer si apre automaticamente | ✅ | — | — | ✅ | ✅ | ✅ |
| 6.2 | Reasoning drawer mostra step cards (context_fetch, dispatch, validation) | ✅ | — | — | ✅ | ✅ | ✅ |
| 6.3 | Con `thinking=true` e blocchi di pensiero → step `thinking` nell'elenco | ✅ | — | — | ✅ | ✅ | ✅ |
| 6.4 | Reasoning drawer si chiude manualmente | ✅ | — | — | ✅ | ✅ | ✅ |
| 6.5 | Toggle thinking OFF → nessuno step `thinking` emesso | ✅ | — | — | ✅ | ✅ | ✅ |
| 6.6 | OpenAI: thinking visibile solo su modello `o3` (su `gpt-*` non emesso) | — | — | — | — | — | ✅ solo o3 |

**Note**: Ollama (P2/P3) non supporta `thinking` → test 6.1–6.5 saltati.
OpenAI supporta thinking solo su `o3`, non su `gpt-*`.
FakeProvider emette `thoughtChunks` solo se configurato → nell'e2e standard
(nessuna configurazione custom) si comporta come nessun thought.

---

## 7. Subagent

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 7.1 | Creare subagent da sidebar (nome + system instruction) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7.2 | Subagent `@nome` menzionato → risposta produce badge subagent nel reasoning drawer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7.3 | Subagent edit: aprire modale, rinominare | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7.4 | Subagent edit: aggiungere skill `clay` → skill visibile nel modale | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7.5 | Subagent edit: aggiungere tool | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7.6 | Invocazione subagent con `thinking=true` → step thinking + subagent badge | ✅ | — | — | ✅ | ✅ | ✅ |

**Note**: La creazione e modifica subagent sono UI puri (provider-indipendenti).
La risposta effettiva del subagent dipende dal provider (7.2, 7.6).

---

## 8. Tool calling (MCP)

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 8.1 | Server MCP mock → Connect → tool `mock.echo` visibile nella sidebar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.2 | Server MCP mock → Disconnect → tool rimosso | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.3 | Server MCP mock → Refresh → `mock.echo` ancora visibile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.4 | Tool `mock.echo` invocato → risultato visibile nel messaggio modello | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.5 | Multipli tool in un unico dispatch (max 10) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.6 | Tool error (MCP server non raggiungibile) → messaggio di errore | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.7 | Tool `autoApprove=true` → eseguito senza richiesta di conferma | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.8 | Builtin MCP: 2 righe toggle (Filesystem, Terminal) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.9 | Builtin MCP: toggle Filesystem ON → OFF → righe ancora 2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Note**: Lato provider la differenza chiave: Anthropic usa `runToolCall`
agentic loop; gli altri emettono `function_call` chunks. Per l'e2e questo
è trasparente (si vede solo il risultato). P1 richiede che FakeProvider
sia configurato con `functionCallSequence`, altrimenti il tool non viene
invocato — vedi 8.10 dedicato.

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 8.10 | FakeProvider: funzione `ping` → chiamata tool → risposta | ✅ | — | — | — | — | — |

**Nota**: Per testare 8.4–8.7 su P1 serve un FakeProvider custom che emetta
`function_call` chunks. Nell'e2e standard (FakeProvider vanilla) il modello
non invoca tool perché il prompt "ping" produce solo "pong". Su P2–P6 il
comportamento dipende dal modello e dal prompt: il test deve inviare un
messaggio che inneschi una tool call (es. "what time is it?" → usa `current_time`).

---

## 9. Breakpoints

| # | Test | Note |
|---|------|------|
| 9.1 | Breakpoint sidebar: 3 righe visibili (safe, dangerous, external) | provider-indipendente |
| 9.2 | Categoria `dangerous` in modalità `gate` → toggle → passa a `auto` | provider-indipendente |
| 9.3 | Categoria `dangerous` ritorna a `gate` dopo secondo toggle | provider-indipendente |
| 9.4 | Tool `safe` con autoApprove=true → breakpoint non blocca | provider-indipendente |
| 9.5 | Tool `dangerous` in modalità `gate` → richiesta approvazione attesa | provider-indipendente |

**Nota**: 9.4 e 9.5 richiedono un tool MCP effettivamente invocato, quindi
la produttoria sui provider è identica a 8.4–8.7.

---

## 10. Fork (branching)

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 10.1 | Invio messaggio → tasto destro sulla bolla utente → "Branch from here" | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10.2 | Sessione forked contiene il messaggio utente originale | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10.3 | Sessione forked: inviare nuovo messaggio → risposta separata dalla sessione originale | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10.4 | Fork su messaggio modello (non utente) → funziona uguale (cammina al messaggio utente più vicino) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 11. Session IO (import/export)

| # | Test | Note |
|---|------|------|
| 11.1 | Palette → importa sessione → riga "Playwright Imported Session" nella sidebar | provider-indipendente |
| 11.2 | Esporta sessione dal menu contestuale → download JSON valido | provider-indipendente |
| 11.3 | Ri-importare un JSON esportato → duplicato funzionante | provider-indipendente |

---

## 12. Profili

| # | Test | Note |
|---|------|------|
| 12.1 | Apri modale profili → Save current as new → nome "e2e profile" → riga visibile | provider-indipendente |
| 12.2 | Applicare un profilo → TopBar mostra il nome del profilo | provider-indipendente |
| 12.3 | Rinominare un profilo | provider-indipendente |
| 12.4 | Eliminare un profilo | provider-indipendente |

---

## 13. Context (System Protocol)

| # | Test | Note |
|---|------|------|
| 13.1 | System Protocol expandibile nella sidebar | provider-indipendente |
| 13.2 | Modificare system instruction nell'editor | provider-indipendente |
| 13.3 | Aggiungere skill → persiste nel context | provider-indipendente |
| 13.4 | Rimuovere skill → scompare dalla lista | provider-indipendente |
| 13.5 | Modificare system instruction → messaggio successivo riflette la nuova instruction | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Nota**: 13.5 dipende dal provider perché verifica che la risposta del
modello segua la nuova system instruction.

---

## 14. Workspace

| # | Test | Note |
|---|------|------|
| 14.1 | Pulsante "Add workspace" apre modale con pulsante "Add this folder" | provider-indipendente |
| 14.2 | Browse entries mostra cartelle del filesystem | provider-indipendente |
| 14.3 | Aggiungere un workspace → riga visibile nella sidebar | provider-indipendente |
| 14.4 | Rimuovere un workspace → riga scomparsa | provider-indipendente |
| 14.5 | Rinominare un workspace | provider-indipendente |

---

## 15. Search

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 15.1 | Invio messaggio → ricerca per contenuto della risposta → risultato trovato | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 15.2 | Ricerca messaggio utente → risultato con snippet | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 15.3 | Ricerca senza risultati → "Nessun risultato" | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 16. Resume (ripristino messaggio interrotto)

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 16.1 | Interrompere uno streaming → pulsante/resume visibile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 16.2 | Cliccare resume → streaming continua dal punto interrotto | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 16.3 | Messaggio completato dopo resume → flag `interrupted` assente | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Nota**: Testare la interruzione su P1 richiede un `chunkDelayMs` che dia
tempo di premere il pulsante stop. Su P2–P6 lo stop è naturale durante
streaming reale. Il FakeProvider vanilla è istantaneo → non interrompibile
nell'e2e standard.

---

## 17. Provider-specific — edge cases

| # | Test | P1 | P2 | P3 | P4 | P5 | P6 |
|---|------|----|----|----|----|----|----|
| 17.1 | API key assente / scaduta → errore 401 not retryable | — | — | — | ✅ | ✅ | ✅ |
| 17.2 | Provider non raggiungibile (rete assente) → errore retryable | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 17.3 | Rate limit (429) → errore retryable | — | — | — | ✅ | ✅ | ✅ |
| 17.4 | Ollama: modello non trovato → errore 404 | — | ✅ | ✅ | — | — | — |
| 17.5 | Ollama: connection refused su host errato | — | — | ✅ | — | — | — |

---

## 18. Chat UI/UX (layout, composer, bolle, reasoning) — provider-indipendente

Test della UX introdotta nel redesign chat. Tutti su **P1 (Fake)** in CI;
nessun provider reale necessario.

| # | Test | Note |
|---|------|------|
| 18.1 | Input composer ancorato in basso; il thread scrolla con scrollbar visibile | layout — regressione "input che scende" |
| 18.2 | Conversazione lunga: lo scroll resta agganciato all'ultimo messaggio (auto-scroll) | |
| 18.3 | Reasoning drawer aperto → la chat si restringe (`mr-96`) e nessuna bolla utente viene coperta | push, non overlay |
| 18.4 | Bolle: header con mittente (Tu / nome modello) + orario; utente a destra, assistente a sinistra | |
| 18.5 | Menu "+" apre il menu azioni; "Add files or photos" apre il file picker | registro `ComposerAction[]` estensibile |
| 18.6 | Pill modello nel composer: apre dropdown, seleziona provider → cambia sessione + default | sostituisce il vecchio combobox in TopBar |
| 18.7 | Pill modello: voce "Refresh models" ricarica la lista | |
| 18.8 | Le tre barre in alto (sidebar / main / reasoning) sono allineate (`h-12`) | |
| 18.9 | Composer: pulsanti (+, modello, thinking, invio) allineati su un'unica riga | regressione disallineamento |
| 18.10 | Toggle thinking disabilitato se il provider attivo non supporta thinking | gate capability |

---

## Riepilogo: test per provider

| Provider | Test totali | Esclusioni |
|----------|------------|------------|
| P1 `fake:default` | 70 | 5.2, 5.3 (vision), 6.1–6.6 (thinking senza thoughtChunks), 8.4–8.7 (tool senza functionCallSequence), 16.1–16.3 (nessun delay), 17.1–17.5 |
| P2 `ollama:local` | 68 | 5.2 (vision), 6.1–6.6 (thinking), 17.1 (no API key) |
| P3 `ollama:remote` | 68 | 5.2 (vision), 6.1–6.6 (thinking) |
| P4 `anthropic` | 74 | — |
| P5 `gemini` | 74 | — |
| P6 `openai` | 72 | 6.6 su gpt- (thinking solo su o3) |

---

## Matrice di priorità per implementazione

### Fase 1 — Core (tutti i provider, alta priorità)
- 2.1 Chat base send/receive
- 2.2 Streaming enable/disable textarea
- 2.4 Multi-turno
- 2.5 Creazione seconda sessione
- 2.6 Cancellazione sessione
- 3.1 Selettore provider
- 3.2 Cambio provider persiste
- 5.1 Allegato testo
- 7.2 Subagent invocazione @mention
- 10.1 Fork
- 15.1 Search

### Fase 2 — Funzionalità thinking/strumenti (provider con capability, media priorità)
- 6.1–6.5 Thinking ON/OFF (saltare P2/P3)
- 8.1–8.4 MCP connect/disconnect/tool execution
- 8.8–8.9 Builtin MCP
- 7.6 Subagent + thinking
- 5.2 Allegato immagine (solo P4/P5/P6)

### Fase 3 — Edge case e resilienza (bassa priorità)
- 5.6 MIME non supportato
- 5.7 Dimensione > 10 MB
- 16.1–16.3 Resume
- 17.1–17.5 Errori provider-specific
- 9.4–9.5 Breakpoint con tool invocation

### Fase 4 — UI pura (provider-indipendente, backlog)
- 1.1–1.5 Shell, palette, import
- 4.1–4.3 Key vault
- 9.1–9.3 Breakpoint UI
- 12.1–12.4 Profili
- 13.1–13.4 System Protocol editing
- 14.1–14.5 Workspace
- 11.1–11.3 Session IO
- 18.1–18.10 Chat UI/UX (composer, bolle, reasoning, pill modello, menu "+")

---

## Strategia di esecuzione & tag

- **PR CI** (`AETHER_FAKE_PROVIDER=1`): tutti i test provider-indipendenti + l'intera
  matrice su **P1 (Fake)**. Deterministico, gratis, veloce. Tag `@ci`.
- **Nightly / manuale**: la matrice sui provider reali **P2–P6**, tag
  `@provider-matrix` + `@provider:<name>` + `@cap:<thinking|tools|vision>`. Usare i
  modelli più economici (claude-haiku, gemini-1.5-flash, gpt-5-mini / o4-mini,
  ollama piccolo). Timeout ≥ 30s, retry abilitati. **Skip automatico** se mancano
  credenziali/endpoint.
- Filtri Playwright: `playwright test --grep "@cap:tools"`,
  `playwright test --grep "@provider:anthropic"`.

**Note provider trasversali (cap. 8/9):**
- **P4 (Anthropic)** esegue i tool tramite il loop agentico del Claude Agent SDK,
  con allow a livello server (`mcp__aether`) per via della normalizzazione dei nomi
  tool (i `.` diventano `_`). **P2/P3/P5/P6** emettono `function_call` chunks. Per
  l'e2e la differenza è trasparente: si verifica solo il risultato + l'ApprovalGate.
- Le **write** su Filesystem mostrano la **DiffView** dentro l'ApprovalGate.
- L'agente Anthropic gira **isolato** (`tools: []`, `settingSources: []`): vede solo
  i tool Aether, niente Bash/skill/CLAUDE.md dell'host.

