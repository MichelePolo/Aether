# Filesystem-based Skills (Anthropic-style) — design

> Le "skills" di Aether evolvono da semplici **etichette** (`{name, enabled}` iniettate
> come bullet list nel system prompt) a **skill in stile Anthropic**: una directory
> autoconsistente con un `SKILL.md` principale che può fare riferimento a risorse,
> reference, codice e script. L'utente copia una skill nella skills dir di Aether e da
> lì la vede e l'attiva/disattiva da UI. Un workflow di creazione guidato da modello
> (sessione di chat dedicata con le skill **brainstorming** + **skill-creator** attive
> e accesso in scrittura al filesystem) genera nuove skill senza che l'utente scriva il
> testo a mano.
>
> Riusa: il built-in **filesystem MCP** (`@modelcontextprotocol/server-filesystem`) per
> lettura/scrittura, `DispatchService.handle` per la sessione di generazione, il pattern
> dei **built-in MCP** (`builtin_mcp_state` + toggle UI) per lo stato, e il pattern
> sidebar-section + Zustand store. **Senza rompere** le skill legacy esistenti.

## 1. Decisioni di brainstorming (locked)

- **Relazione con l'esistente = estendi.** Una skill *evolve*: può essere solo-etichetta
  (legacy, `dir` assente, comportamento identico a oggi) oppure avere materiale in una
  directory. Un solo concetto, un'unica sezione UI. Nessuna migrazione distruttiva.
- **Consumo = ibrido.** Nome+descrizione di ogni skill abilitata sempre nel prompt; il
  `SKILL.md` completo iniettato inline **solo** per le skill *pinnate* dall'utente; le
  altre restano **progressive disclosure** — il modello legge `SKILL.md` e risorse via
  il filesystem MCP quando le ritiene rilevanti.
- **Source of truth = filesystem.** Aether scansiona `${AETHER_DATA_DIR}/skills/`. Ogni
  sottodirectory con un `SKILL.md` valido è una skill. Il DB tiene solo lo stato
  (`enabled`/`pinned`). Copiare una cartella la fa comparire in UI automaticamente
  (come i built-in MCP: l'artefatto esiste, il DB traccia il toggle).
- **Flusso creazione = sessione di chat dedicata.** Riusa `DispatchService` con le skill
  `brainstorming` + `skill-creator` pinnate e accesso in scrittura al filesystem.
  Massima fedeltà al modo in cui quelle skill sono pensate (loop agentico conversazionale).
- **Destinazione generazione = staging → review → promote.** Il modello scrive in
  `${AETHER_DATA_DIR}/skills/.drafts/<slug>/`. La skill NON è attiva finché l'utente non
  la rivede e la **promuove** nella skills dir vera.
- **Scope = globale (v1).** Skill material globali (enable/pin globale). I subagent
  possono ancora referenziarle per slug col meccanismo attuale. Override per-profilo =
  fuori scope v1 (YAGNI).
- **Script = materiale di riferimento (v1).** Script/risorse sono leggibili dal modello;
  l'eventuale esecuzione passa dal **terminal MCP** esistente con gating breakpoint.
  Nessun nuovo path di esecuzione.

## 2. Cosa si riusa vs. cosa si costruisce

**Riusato intatto:** il built-in **filesystem MCP** (lettura per progressive disclosure,
scrittura confinata per la generazione), `DispatchService.handle` (sessione di
generazione), il pattern `builtin_mcp_state` (tabella di stato gemella), il pattern
sidebar-section + Zustand store ottimistico, le route legacy `/api/context/skills`
(restano per le skill label).

**Costruito:** un nuovo dominio `server/domain/skills/` (types/schema/store/service +
parser frontmatter + discovery), una migrazione per `skill_state`, route HTTP
`/api/skills`, il seed idempotente dei default in `bootstrap()`, le due skill di default
bundlate nel repo, e il frontend (api/store/evoluzione `SkillsSection` + flusso di
generazione). Modifica a `prompt-assembler.ts` per il consumo ibrido.

## 3. Modello dati

Forma `Skill` unificata verso il frontend (storage sdoppiato):

```ts
interface Skill {
  name: string;                    // slug = nome directory = `name:` nel frontmatter
  enabled: boolean;
  source: 'label' | 'material';    // 'label' = legacy, 'material' = directory
  pinned?: boolean;                // solo material: forza inline del SKILL.md
  description?: string;            // letta dal frontmatter del SKILL.md (solo material)
  invalid?: string;                // motivo se la dir non è una skill valida (solo material)
}
```

Storage:
- **Skill legacy (`label`)** → restano in `context_skills` (e `profile_skills` /
  `subagent_skills`) esattamente come oggi.
- **Skill material** → esistenza dal **filesystem scan**; stato in una nuova tabella:
  ```sql
  -- migrations/NNN_skill_state.sql
  CREATE TABLE skill_state (
    slug    TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,   -- material disabilitate di default
    pinned  INTEGER NOT NULL DEFAULT 0
  );
  ```
  Righe orfane (slug senza directory) vengono ignorate dalla `list()` e possono essere
  ripulite; slug nuovi (directory senza riga) assumono i default (`enabled=0, pinned=0`).

## 4. Layout filesystem & seeding dei default

```
${AETHER_DATA_DIR}/skills/
  .drafts/                    ← staging delle generazioni in corso (escluso dallo scan)
  brainstorming/              ← default seedata
    SKILL.md
  skill-creator/              ← default seedata
    SKILL.md
    resources/ ...
  <skill copiate a mano>/
```

- I default vivono bundlati nel repo in `server/skills/defaults/<slug>/…` e vengono
  **copiati nella data dir al boot se assenti** (seed idempotente in `bootstrap()`, dopo
  le migrazioni). Non sovrascrivono modifiche utente; aggiornabili in futuro tramite
  versione nel frontmatter.
- Una directory è una skill **valida** se contiene un `SKILL.md` con frontmatter YAML che
  ha almeno `name` e `description`, e `name` combacia con il nome della directory. Dir
  senza `SKILL.md` valido → compaiono in UI con `invalid` valorizzato e non attivabili.
- `.drafts/` (e qualsiasi dir che inizia con `.`) è escluso dallo scan delle skill attive.

## 5. Backend

### 5.1 Discovery + parser — `server/domain/skills/`
- `parseFrontmatter(md): { name?, description?, ... }` — parser minimale del solo header
  YAML (`---` … `---`), ristretto a `name`/`description`. Nessuna nuova dipendenza pesante.
- `discoverMaterialSkills(skillsDir): MaterialSkill[]` — scansiona le sottodirectory,
  legge il `SKILL.md`, valida frontmatter e match dir↔`name`, marca le invalide.

### 5.2 Service — `SkillsService`
- `list(): Skill[]` — fonde scan filesystem (material) + `context_skills` (label) + stato
  da `skill_state`. Ordine: material valide, poi label legacy, poi invalide.
- `setEnabled(slug, enabled)` / `setPinned(slug, pinned)` — upsert in `skill_state`.
- `listDrafts(): DraftSkill[]` — scansiona `.drafts/`.
- `promote(slug)` — sposta `.drafts/<slug>/` → `skills/<slug>/` (rifiuta se esiste già o
  se la draft è invalida); crea la riga `skill_state` disabilitata.
- `remove(slug)` — elimina la directory material e la riga di stato.

### 5.3 Routes — `/api/skills`
- `GET /api/skills` → lista fusa (`Skill[]`) + drafts.
- `PATCH /api/skills/:slug/enabled` → `{ enabled }`.
- `PATCH /api/skills/:slug/pinned` → `{ pinned }`.
- `POST /api/skills/promote` → `{ slug }`.
- `DELETE /api/skills/:slug`.
- Le route legacy `/api/context/skills` restano invariate per le skill label.

## 6. Progressive disclosure (ibrido) — `prompt-assembler.ts`

`assemble()` si ramifica per ogni skill abilitata:
- **Skill legacy (`label`)** → invariata (solo nome nel blocco `# Active Skills`).
- **Skill material abilitata, non pinnata** → riga `- <name>: <description>` nel blocco,
  + nota che il contenuto completo è leggibile via filesystem nella skills dir (path
  indicato), così il modello può aprirlo on-demand.
- **Skill material pinnata** → l'intero `SKILL.md` iniettato inline.

**Accoppiamento filesystem MCP:** la progressive disclosure richiede che il modello possa
leggere la skills dir. Se esiste una skill material abilitata ma il filesystem MCP è off
(o il suo `fsRoot` non copre la skills dir), la UI mostra un **avviso azionabile**
("Abilita il filesystem MCP per la lettura delle skill"). Non si auto-accende nulla a
sorpresa.

## 7. Sessione di generazione (riusa `DispatchService`)

Bottone "Create Skill with AI" →
1. **Selettore del modello** tra i provider disponibili nel registry.
2. Si apre una **sessione Aether dedicata** pre-configurata:
   - skill `brainstorming` + `skill-creator` iniettate **inline** nel system prompt come
     **attivazione session-local** (non il flag `pinned` globale di `skill_state`: quelle
     due restano non-pinnate a livello globale, l'inline vale solo per questa sessione);
   - un filesystem MCP **rootato su `.drafts/`** (scrittura confinata allo staging).
3. L'utente dialoga: brainstorming decide le funzionalità, skill-creator scrive i file in
   `.drafts/<slug>/`.
4. A fine generazione, la UI mostra la draft con azione **Review → Promote**. Il promote
   sposta in `skills/<slug>/` (disabilitata di default).

## 8. Frontend

- `SkillsSection.tsx` evolve in **un'unica lista** che mostra skill label + material, con:
  badge tipo (`label`/`material`), toggle `enabled`, toggle **pin** (solo material), badge
  `invalid` col motivo, avviso filesystem-MCP-off quando serve, e una sotto-sezione
  **Drafts** con Review/Promote.
- Nuovo `src/stores/skills.store.ts` + `src/lib/api/skills.api.ts` (pattern ottimistico,
  modellato su `mcp.store.ts`). Le skill legacy continuano a passare da `context.store`.
- i18n: nuove stringhe in `src/i18n/`.

## 9. Testing

- **Backend** (soglia 80% su `server/domain/skills/**`):
  discovery (dir valida / senza SKILL.md / frontmatter mancante / mismatch dir↔name),
  parser frontmatter, fusione label+material+stato, seed idempotente (non sovrascrive),
  promote da draft (ok / già esistente / invalida), assemble ibrido (pinned vs non-pinned
  vs legacy).
- **Frontend:** store ottimistico + rollback su errore, rendering lista fusa, stato
  drafts/promote, avviso filesystem-MCP-off.

## 10. Fuori scope (v1)

- Override delle skill per-profilo / per-subagent (solo globale per ora).
- Esecuzione diretta degli script delle skill (passa dal terminal MCP esistente).
- Versioning/aggiornamento automatico dei default oltre il seed idempotente.
- Editing del contenuto del `SKILL.md` dalla UI (si edita sul filesystem o si rigenera).
