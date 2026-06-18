# Indagine sull'utilizzo del contesto nella chat di Aether

> Analisi di cosa viene effettivamente inviato al modello ad ogni dispatch, per
> casi d'uso. Basata sulla lettura di `DispatchService.handle()`/`resume()`
> (`server/domain/dispatch/dispatch.service.ts`), dell'assemblatore
> `assemble()` (`server/domain/dispatch/prompt-assembler.ts`), del provider
> Anthropic (`server/domain/dispatch/providers/anthropic.provider.ts`) e dei
> moduli di contorno (skills, project memory, attachments).

---

## Come Aether costruisce il contesto: il quadro generale

Il punto chiave da capire subito è che **Aether non mantiene un "contesto vivo"
lato modello**: ad ogni messaggio ricostruisce *da zero* l'intero payload e lo
rispedisce. Non c'è finestra scorrevole, né riassunto, né caching del prompt.
Il payload inviato al provider ha sempre tre componenti
(`RunDispatchLoopOpts` in `dispatch.service.ts:108`):

| Componente | Cosa contiene | Origine nel codice |
|---|---|---|
| `systemInstruction` | system base + runtime + project memory + skills + (eventuale) sub-agent | `assemble()` in `prompt-assembler.ts:97` |
| `history` | **tutti** i messaggi precedenti (user+model), non troncati | `prior.map(...)` in `dispatch.service.ts:529` |
| `userMessage` | messaggio corrente (mention rimossa, allegati testuali inlined) | `assembled.message` + `inlineTextAttachments` |
| `mcpTools` | dichiarazioni tool MCP live (nome+descrizione+schema) | `mcpToolDecls` in `dispatch.service.ts:476` |
| `attachments` | solo immagini, solo se il provider ha `vision` | `dispatch.service.ts:504` |

### Insight

- **`ctx.tools` NON viene inviato al modello.** Nell'oggetto `AssembledPrompt`
  esistono `tools` *e* `mcpTools`, ma `runDispatchLoop` passa al provider solo
  `mcpTools` (`dispatch.service.ts:533`). I "Tool" del context
  (`{id,name,version,status}`) sono solo metadati di UI/registro: le uniche
  funzioni che il modello può davvero chiamare sono i **tool MCP live**.
- **Il runtime è dinamico per turno.** `buildRuntimeFacts`
  (`dispatch.service.ts:138`) inietta `Current time (UTC)` + `Active model` ad
  ogni dispatch — quindi *anche con sistema identico, il prompt cambia ad ogni
  turno* (l'orario), il che da solo impedirebbe un cache hit esatto.
- **Skills a "progressive disclosure".** Solo le skill *pinned* hanno il corpo
  `SKILL.md` inlinato; le non-pinned mandano solo `nome: descrizione` + il path
  su disco, lasciando che il modello legga il file via tool filesystem se serve
  (`prompt-assembler.ts:41`).

---

## Anatomia del `systemInstruction` (ordine di assemblaggio)

Da `assemble()` → `withRuntimeContext()` → `withSkillsBlock()`, i blocchi
vengono concatenati con `\n\n` in quest'ordine:

```
<ctx.systemInstruction>                          ← sempre
# Sub-agent: <name>\n<subAgent.systemInstruction> ← solo se @mention risolta
# Runtime\nCurrent time (UTC): …\nActive model: … ← sempre
# Project memory (ETERE.md)\n<ETERE.md>          ← solo se esiste nel workspace (cap 32KB)
# Active Skills
- <label skill>                                  ← skill "context" abilitate (solo nome)
- <material skill>: <description>                ← skill su disco non-pinned (nome+desc+path)
## Skill: <name>\n<corpo SKILL.md completo>       ← skill pinned (corpo intero inlinato)
```

---

## Matrice per casi d'uso (cosa parte davvero)

Legenda: ✅ inviato · ➖ assente · 🔁 ricostruito e re-inviato ogni volta

| # | Caso d'uso | system base | runtime | ETERE.md | skills block | sub-agent | tool MCP | history | note token |
|---|---|---|---|---|---|---|---|---|---|
| **A** | 1° prompt minimale (no skill/MCP/subagent) | ✅ | ✅ | se presente | ➖ | ➖ | ➖ | vuota | minimo |
| **B** | 1° prompt, skill abilitate | ✅ | ✅ | se presente | ✅ | ➖ | ➖ | vuota | +descr (o +corpo se pinned) |
| **C** | 1° prompt, server MCP online | ✅ | ✅ | se presente | ✅/➖ | ➖ | ✅ schema completo | vuota | +N schemi tool |
| **D** | 1° prompt con `@subagent …` | ✅ | ✅ | se presente | ✅ (label+subagent.skills) | ✅ | ✅ | vuota | +instr subagent |
| **E** | 1° prompt con allegati | ✅ | ✅ | se presente | … | … | … | vuota | testo→fenced nel msg; img→solo se vision |
| **F** | **2° prompt stessa sessione** | 🔁 | 🔁 (orario nuovo) | 🔁 | 🔁 | 🔁 (solo se ri-menzioni) | 🔁 | **tutto lo storico** | cresce O(n) |
| **G** | Loop tool dentro un dispatch | (vedi sotto) | | | | | ✅ | accumulato | re-invio per round (non-Anthropic) |
| **H** | Resume messaggio interrotto | ✅ | ✅ | se presente | ➖ **assente** | ➖ **assente** | ✅ | fino al msg interrotto | system "leggero" |

### Dettagli non ovvi per caso

**Caso D (sub-agent).** La mention deve essere *in testa* al messaggio
(`parseLeadingMention`) e viene **rimossa** dal testo inviato
(`mention.stripped`). Il sub-agent contribuisce: la sua `systemInstruction`
(blocco `# Sub-agent`), le sue `skills` (fuse nelle label), i suoi `tools`
(fusi in `ctx.tools` → **ma ancora una volta non inviati al modello**, solo
metadati). Quindi un sub-agent in pratica cambia *solo system instruction +
lista nomi skill*.

**Caso F (secondo prompt).** Questo è il punto più importante per i costi:
`historyStore.read()` restituisce **l'intera sessione senza troncamento** e
viene rispedita per intero (`dispatch.service.ts:393,529`). Inoltre **il
sub-agent NON è sticky**: se al 1° turno hai scritto `@reviewer …` ma al 2° no,
il blocco sub-agent sparisce. Idem per le skill: vengono rilette dallo stato
corrente ad ogni turno, quindi togglarle tra un messaggio e l'altro cambia ciò
che parte.

**Caso G (loop tool nel singolo dispatch).** Qui c'è una divergenza forte tra
provider:

- **Anthropic** (`anthropic.provider.ts`): passa `runToolCall` all'SDK e il
  loop multi-step avviene *dentro* l'SDK (`maxTurns: 24`). Aether chiama
  `stream()` **una sola volta**; i re-invii alla API li gestisce l'SDK
  internamente.
- **Gemini / OpenAI / Ollama**: emettono un chunk `function_call`, Aether esce
  dallo stream, esegue il tool, e **richiama `provider.stream()`** con i
  `toolResults` (`dispatch.service.ts:271-337`). Ogni round **re-invia system +
  history + testo accumulato** → la crescita di token per dispatch con molti
  tool è significativa.

**Caso H (resume).** Percorso volutamente più magro
(`dispatch.service.ts:697`): usa `withRuntimeContext` *senza* `withSkillsBlock`
e *senza* sub-agent. Quindi su un resume il modello perde il blocco skill e
l'identità del sub-agent — asimmetria da tenere a mente.

---

## Specificità del provider Anthropic (importante)

Aether usa il `@anthropic-ai/claude-agent-sdk`, che in input streaming accetta
**solo messaggi `role:'user'`**. Conseguenza (`anthropic.provider.ts:220`
`renderConversation`): **tutta la history + il messaggio corrente vengono
appiattiti in UN UNICO messaggio user di testo**:

```
# Conversation so far
User: …
Assistant: …
User: …

<userMessage corrente>
```

### Insight

- **Niente struttura dei turni su Anthropic.** I turni assistant passati non
  sono "veri" turni API ma testo trascritto dentro un blocco. Questo cambia
  come il modello "vede" la conversazione rispetto agli altri provider.
- **Isolamento forte:** `tools: []` e `settingSources: []`
  (`anthropic.provider.ts:93`) disabilitano i tool nativi del `claude` spawnato
  e impediscono che skill/CLAUDE.md dell'host "trapelino". Il modello vede
  *solo* il systemPrompt e i tool MCP di Aether.
- **Nessun prompt caching configurato.** Non viene impostato alcun
  `cache_control`; sommato al runtime-clock variabile, ogni turno è input nuovo
  da pagare per intero.

---

## Sequence diagram — flusso di un dispatch

```mermaid
sequenceDiagram
    actor U as Utente
    participant D as DispatchService.handle()
    participant H as HistoryStore
    participant C as ContextStore
    participant S as SubAgentsStore
    participant SK as SkillsService
    participant PM as ETERE.md (fs)
    participant MCP as McpRegistry
    participant A as assemble()
    participant P as Provider (stream)
    participant M as Modello LLM

    U->>D: POST /dispatch {sessionId, message, attachments?, providerName?}
    D->>H: readRecord(sessionId)  %% provider sticky + workspaceId
    D->>H: read(sessionId)        %% TUTTA la history
    D->>C: read()                 %% systemInstruction + skills(label) + tools(meta)
    D->>S: list()+read()          %% nomi sub-agent noti
    D->>D: parseLeadingMention()  %% risolve @subagent, strip dal testo
    D->>D: preprocessAttachments() %% testo→inline, img→vision-only, cap 10MB
    D->>MCP: listLiveTools()       %% → mcpToolDecls (name+desc+schema)
    D->>SK: getActiveForPrompt()   %% skill material (pinned=corpo, else desc+path)
    D->>PM: readProjectMemory()    %% ETERE.md del workspace (cap 32KB)
    D->>D: buildRuntimeFacts()     %% UTC now + modello (dinamico per turno!)
    D->>A: assemble(ctx, subAgent, msg, mcpTools, skills, runtime, projMem)
    A-->>D: {systemInstruction, message, mcpTools}
    D->>H: append(user message)

    loop runDispatchLoop (tool rounds)
        D->>P: stream({systemInstruction, history(tutta), userMessage, mcpTools, toolResults?})
        P->>M: invio payload completo (su Anthropic: history appiattita in 1 msg user)
        M-->>P: chunk text / thinking / function_call / done
        alt function_call (Gemini/OpenAI/Ollama)
            P-->>D: function_call
            D->>MCP: gate (auto|gate 60s) + callTool
            MCP-->>D: result → toolResults
            Note over D,P: re-invio system+history nel round successivo
        else Anthropic
            Note over P,M: loop tool gestito DENTRO l'SDK (maxTurns 24)
        end
    end
    P-->>D: done {usage tokensIn/Out}
    D->>H: append(model message + reasoningSteps)
    D-->>U: SSE done
```

## Crescita del contesto nei turni (perché conta)

```mermaid
sequenceDiagram
    participant T1 as Turno 1
    participant T2 as Turno 2
    participant T3 as Turno 3
    Note over T1: SYS(full) + [] + msg1
    Note over T2: SYS(full, ricostruito) + [msg1, risp1] + msg2
    Note over T3: SYS(full, ricostruito) + [msg1,risp1,msg2,risp2] + msg3
    Note over T1,T3: SYS re-inviato OGNI volta · history mai troncata · O(n) tokens
```

---

## Conclusioni operative

1. **Il system instruction si paga ad ogni turno**, intero. Se hai molte skill
   *pinned* o un ETERE.md grande, quel costo si moltiplica per il numero di
   messaggi.
2. **La history non viene mai potata né riassunta** → le sessioni lunghe
   crescono linearmente fino al limite della finestra del modello (nessuna
   gestione esplicita: rischio di errori "context length" su sessioni molto
   lunghe).
3. **`ctx.tools` non è contesto reale per il modello** — solo i tool MCP live
   lo sono. Disabilitare/abilitare server MCP è ciò che cambia davvero le
   capability del modello.
4. **Sub-agent e skill sono per-turno**, non sticky: vanno rievocati. Il
   `resume` per giunta li omette del tutto.
5. **Nessun prompt caching** + runtime-clock variabile ⇒ ogni turno è input
   "fresco". Se i costi/latency contassero, i candidati naturali per
   un'ottimizzazione sono: caching del prefisso stabile del system su Anthropic,
   e una strategia di troncamento/riassunto della history.
