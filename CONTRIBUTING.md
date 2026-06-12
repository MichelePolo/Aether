# Contributing — workflow del repository

Questo repo segue **GitHub Flow** con `main` protetto. `main` è sempre deployabile;
ogni modifica entra esclusivamente tramite Pull Request approvata dall'owner.

## Regole d'oro

1. **Non si pusha mai direttamente su `main`** (è bloccato per tutti, owner incluso).
2. Ogni lavoro parte da un branch dedicato e finisce in una **PR verso `main`**.
3. Una PR si può mergiare **solo dopo l'approvazione di @MichelePolo** (Code Owner).
4. La cronologia di `main` è **lineare**: si mergia in **squash** (niente merge commit).

## Flusso passo-passo

```bash
# 1. Allineati a main
git checkout main
git pull

# 2. Crea un branch dal prefisso giusto (vedi convenzioni sotto)
git checkout -b feat/breve-descrizione

# 3. Lavora, commit piccoli e frequenti
git add -A && git commit -m "feat: ..."

# 4. Pusha e apri la PR
git push -u origin feat/breve-descrizione
gh pr create --base main --fill   # oppure dalla UI di GitHub

# 5. Attendi la review di @MichelePolo. Applica i feedback sullo stesso branch.
# 6. A merge avvenuto (squash), il branch viene cancellato automaticamente.
```

## Convenzioni nomi branch

| Prefisso     | Uso                                            |
|--------------|------------------------------------------------|
| `feat/`      | nuova funzionalità                             |
| `fix/`       | bugfix                                          |
| `docs/`      | solo documentazione                            |
| `refactor/`  | refactor senza cambiare comportamento          |
| `chore/`     | build, dipendenze, tooling                     |

Per il lavoro a slice si usa `feat/slice-N-<nome>` (vedi `docs/superpowers/roadmap.md`).

## Commit & PR

- Messaggi di commit in stile **Conventional Commits** (`feat:`, `fix:`, `docs:`…).
- La PR deve passare i controlli richiesti (lint/test) prima del merge.
- Risolvi tutte le conversazioni di review prima del merge.

## Versioning & release (automatico)

Il versioning è gestito da **release-please** (`.github/workflows/release-please.yml`): legge i
Conventional Commits arrivati su `main`, mantiene una **"release PR"** che aggiorna
`package.json` + `CHANGELOG.md`, e al merge crea il **tag** e la **GitHub Release**. Non si
bumpano versioni a mano.

- `feat:` → bump **minor**, `fix:` → bump **patch**, `feat!:`/`BREAKING CHANGE:` → bump major
  (pre-1.0: minor). `docs/chore/refactor/test` non rilasciano.
- **Importante**: poiché si mergia in **squash**, è il **titolo della PR** a diventare il
  messaggio di commit su `main` — quindi il titolo della PR **deve** essere un Conventional
  Commit valido (es. `feat(context): ...`), altrimenti release-please lo ignora.

## Migrations

Le migrations SQLite sono **append-only** e numerate `NNN_nome.sql`. Il numero è una risorsa
sequenziale condivisa: branch paralleli possono scegliere lo stesso numero e collidere. Un test
(`server/db/migrate.naming.test.ts`) fallisce in CI su duplicati/gap. Se due branch finiscono con
lo stesso `NNN`, la **seconda** PR che entra deve rinumerare la propria migration al numero libero
successivo.

## Checklist prima di aprire la PR

- [ ] `npm run lint` pulito
- [ ] `npm run test:run` verde
- [ ] Branch aggiornato con `main` (no conflitti)
- [ ] Titolo PR in **Conventional Commits** (guida il versioning automatico)
- [ ] Descrizione PR con cosa/perché + come testare
