# Spettro Invisibile — Design (reskin visivo di Aether)

**Goal:** dare ad Aether un'identità visiva distintiva tramite una palette dedicata
("Spettro Invisibile") coerente col motto *disclosure & manipulation*, senza
toccare la logica dei componenti.

**Vincolo cardine:** **solo presentazione.** Nessuna modifica a handler, stato,
data-flow o markup funzionale. Cambiano: valori dei token in `theme.css`, alcune
regole in `components.css`, e gli `className` *di colore* nei componenti. Gli unici
test che possono cambiare sono quelli che asseriscono classi-colore (es.
`bg-accent`) — non comportamento.

---

## 1. Sistema di token (`src/styles/theme.css`)

### 1a. Superfici e testo — rimappatura sui valori "zinc"
I **nomi** dei token esistenti restano invariati (così la maggior parte dei
componenti non va toccata per le superfici); cambiano solo i **valori**:

| Token | Prima | Dopo | Ruolo |
|---|---|---|---|
| `--color-surface-0` | `#080808` | `#09090B` | Il Vuoto (sfondo assoluto) |
| `--color-surface-1` | `#0a0a0a` | `#09090B` | sfondo app principale |
| `--color-surface-2` | `#0f0f0f` | `#18181B` | L'Etere (pannelli/superfici) |
| `--color-surface-3` | `#121212` | `#1F1F23` | superfici annidate / hover |
| `--color-surface-4` | `#1a1a1a` | `#27272A` | superfici elevate |
| `--color-surface-5` | `#2a2a2a` | `#3F3F46` | superfici massime |
| `--color-border-subtle` | `#27272A` | `#27272A` | (invariato) bordo container |
| `--color-border-default` | `#3f3f46` | `#3F3F46` | (invariato) bordo marcato |
| (nuovo) `--color-text` | — | `#F4F4F5` | testo principale (Ghiaccio) |
| (nuovo) `--color-text-dim` | — | `#A1A1AA` | testo secondario / timestamp |

> I `zinc-*` di Tailwind usati oggi (`text-zinc-100/200/300/400/500/600`) restano
> validi e cadono naturalmente in gamma con la nuova scala: non vanno sostituiti
> in massa. `--color-text`/`--color-text-dim` sono per i nuovi usi espliciti.

### 1b. I tre accenti semantici (sostituiscono l'unico `--color-accent`)
Aggiunti a `@theme` (Tailwind v4 genera `bg-/text-/border-<name>` + tinte `/NN`):

```
--color-disclosure:   #B388FF   /* viola UV — rivelare l'invisibile */
--color-manipulation: #FF6D00   /* arancio elettrico — agire/alterare stato */
--color-cli:          #00E676   /* verde fosforo — SOLO output grezzo CLI/tool */
```

`--color-accent` resta definito ma **ripuntato su `--color-manipulation`** come
solo *fallback di sicurezza* per eventuali usi non ancora migrati; l'obiettivo è
che dopo l'audit non resti nessun `accent` "implicito".

### 1c. Status colors — invariati
`--color-status-online/connecting/offline/error` restano com'è: sono **stato**,
non brand. Il `status-online` (#22c55e) per il dot di connessione **non** è il
verde "Heritage CLI" e non va riassegnato.

---

## 2. Rimappatura semantica (l'audit è il grosso del lavoro)

Regola: per **ogni** occorrenza di `accent` / verde-brand nei componenti,
riassegnare al ruolo corretto. Inventario via `grep -rn "accent\|#00ff9d"` su
`src/`. Mappatura per ruolo:

| Ruolo → token | Elementi (componenti noti) |
|---|---|
| **Disclosure** `disclosure` | `ReasoningDrawer` (header + step), toggle **Thinking** attivo (`MessageInput`), chip "N step" / "thinking…" (`MessageBubble`), label mittente *assistant* + "{model} thoughts" (`dispatch`/bubble header), token chip (`TokenChip`, chip composer), `SystemProtocolSection`/context, badge subagent nel reasoning |
| **Manipulation** `manipulation` | **Invia**/**Stop** (`MessageInput`), **Approva**/Reject (`ApprovalGate`/breakpoints), bolla **utente** (`bg-manipulation/10` + `border-manipulation/30`, oggi `accent`), focus-ring degli input attivi (`focus-within:ring`), `ToolCallBanner` azioni |
| **Heritage CLI** `cli` | **solo** output grezzo Terminal/tool-result e blocchi mono (`cli`/code raw). Nessun pulsante verde. |
| **Neutro** (text-dim → hover text) | pill modello (`ComposerModelPill`, tranne il ✓ attivo che può restare neutro/disclosure), "+" (`ComposerPlusMenu`), icone non-azione, `icon-btn` |

Casi specifici da non sbagliare:
- `MessageBubble` bolla utente: oggi `bg-accent/10 border-accent/25` (verde) →
  `bg-manipulation/10 border-manipulation/30`.
- `MessageBubble` reasoning button + `ComposerModelPill` ✓ attivo: oggi `text-accent`
  → `text-disclosure`.
- `MessageInput` Send: oggi `bg-accent/20 text-accent` → `bg-manipulation/20 text-manipulation`
  (o pieno arancio come da mockup approvato).
- `MessageInput` Thinking toggle attivo: `bg-accent/15 text-accent` → `…disclosure`.

---

## 3. Glassmorphism (sobrio)
`backdrop-blur` leggero (≈ `blur(6–8px)`) + fondo semitrasparente **solo** su:
le 3 barre in alto (TopBar, header sidebar, header ReasoningDrawer), i modali/overlay
(`ApprovalGate`, `CommandPalette`, `DialogHost`, altri modali) e il `ReasoningDrawer`.
**Mai** su bolle chat o blocchi di codice/CLI (leggibilità su testi lunghi).

## 4. Hover "trasferimento di energia"
Sugli elementi manipolabili l'hover **illumina il bordo** col colore del ruolo
(`box-shadow: 0 0 0 1px <role>, 0 0 12px -2px <role>` + `border-color`) in
`transition`, invece del solo cambio di `background`. Manipulable → glow
`manipulation`; superfici disclosure-interattive → glow `disclosure`.
Rispettare `motion-reduce`.

## 5. Tipografia — invariata
Inter (UI/chat) + JetBrains Mono (Disclosure/CLI/label). Già in `theme.css`.
Nessuna nuova dipendenza font.

---

## 6. Scope & file toccati
- `src/styles/theme.css` — nuovi/rimappati token (§1).
- `src/styles/components.css` — utility glass (`.glass`), hover-glow, eventuale
  aggiornamento scrollbar al nuovo accento.
- Componenti: sostituzioni `className` di colore secondo §2 (chat, layout, reasoning,
  composer, breakpoints/approval, sidebar badges). Nessun cambio di markup/logica.
- Test: aggiornare le poche asserzioni su classi-colore se presenti (es. ricerche di
  `bg-accent`/`text-accent`); **nessun** test funzionale deve cambiare.

## 7. Testing
- `npx tsc --noEmit` pulito.
- `npx vitest run --project frontend` verde (aggiornando solo asserzioni di
  classe-colore eventuali).
- Verifica visiva nel browser (utente): sfondo/superfici zinc, Invia arancio,
  reasoning/thinking viola, output CLI verde, hover-glow sui bordi, glass sulle barre.

## 8. Out of scope
- Light theme / theme switcher (solo dark "Spettro Invisibile").
- Nuovi font, nuove icone, ridisegno di layout o componenti.
- Qualsiasi cambiamento funzionale (handler, store, API, markup strutturale).

**Open questions:** nessuna (palette, mappatura, font e glass approvati in brainstorming).
