# Per iniziare

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [Getting started](../getting-started.md).

Da zero al primo dispatch. Quando leggerlo: hai appena clonato o installato Aether.

## Installazione

Consulta il [`README.md`](../../README.md) nella radice del repository per gli installer one-liner (tarball prebuilt via curl/PowerShell, oppure installazione globale con `npm`/`pnpm`/`bun`) e per **Esecuzione locale** (`npm install`, poi `npm run dev`). Questa pagina riprende da lì — non ripete i passi di installazione.

## Esplorare senza chiavi

Non servono chiavi API per provare Aether. Esegui:

```bash
AETHER_FAKE_PROVIDER=1 npm run dev
```

Questo rende il **provider Fake** integrato il provider predefinito. Trasmette una risposta preconfezionata (`pong`) con una breve fase simulata di "sto pensando…" e piccoli ritardi artificiali per ogni chunk, così puoi esercitare l'intera UI — dispatch, streaming, cassetto del ragionamento, cronologia — senza alcuna credenziale di provider (`server/domain/dispatch/providers/fake.provider.ts`, collegato in `server/index.ts`).

## Abilitare un provider reale

Quando sei pronto a usare un modello reale, puoi:

- **Variabili d'ambiente** — impostare `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, o `OLLAMA_HOST` prima di avviare l'app, oppure
- **Il pannello Provider Auth nell'app** — memorizzare una chiave cifrata nel KeyVault locale senza toccare le variabili d'ambiente.

La risoluzione della chiave dà priorità all'ambiente, poi al vault. Vedi [`guides/providers.md`](guides/providers.md) per come funzionano la selezione del provider, la risoluzione delle chiavi e gli endpoint vLLM/compatibili OpenAI.

## Il tuo primo dispatch

1. Apri <http://localhost:3000>.
2. Scegli un provider nel selettore di provider della TopBar (questa scelta è "persistente" — viene salvata sulla sessione e diventa il predefinito per le nuove sessioni).
3. Scrivi un messaggio e invialo.

La risposta viene trasmessa in streaming man mano che viene generata. Se abiliti il "pensiero" per un provider capace di ragionamento, il suo ragionamento intermedio compare nel cassetto del ragionamento; l'uso dei token (input/output) viene riportato al termine del turno (`server/domain/dispatch/dispatch.service.ts`).

## Dove si trovano le cose

Per impostazione predefinita, il database SQLite di Aether si trova in `./data/aether.sqlite` (relativo a dove viene avviato il processo). Sovrascrivi la directory con `AETHER_DATA_DIR` (`server/config.ts`). Vedi [`reference/database.md`](../reference/database.md) per lo schema e il modello di migrazione.

## Successivo

→ [`architecture.md`](../architecture.md) — il modello mentale dell'intero sistema.
