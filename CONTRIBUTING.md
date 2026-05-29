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

## Checklist prima di aprire la PR

- [ ] `npm run lint` pulito
- [ ] `npm run test:run` verde
- [ ] Branch aggiornato con `main` (no conflitti)
- [ ] Descrizione PR con cosa/perché + come testare
