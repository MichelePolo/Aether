# Contributing — repository workflow

This repo follows **GitHub Flow** with protected `main`. `main` is always deployable;
every change lands exclusively via Pull Request approved by the owner.

## Golden rules

1. **Never push directly to `main`** (it is locked for everyone, owner included).
2. All work starts on a dedicated branch and ends in a **PR to `main`**.
3. A PR can only be merged **after approval from @MichelePolo** (Code Owner).
4. The history of `main` is **linear**: we merge via **squash** (no merge commits).

## Step-by-step flow

```bash
# 1. Sync to main
git checkout main
git pull

# 2. Create a branch with the correct prefix (see conventions below)
git checkout -b feat/short-description

# 3. Work, small and frequent commits
git add -A && git commit -m "feat: ..."

# 4. Push and open the PR
git push -u origin feat/short-description
gh pr create --base main --fill   # or from GitHub's UI

# 5. Wait for review from @MichelePolo. Apply feedback on the same branch.
# 6. Once merged (squash), the branch is deleted automatically.
```

## Branch naming conventions

| Prefix       | Usage                                          |
|--------------|------------------------------------------------|
| `feat/`      | new feature                                    |
| `fix/`       | bugfix                                         |
| `docs/`      | documentation only                             |
| `refactor/`  | refactor without changing behavior             |
| `chore/`     | build, dependencies, tooling                   |

For slice-based work, use `feat/slice-N-<name>` (see `docs/superpowers/roadmap.md`).

## Commit & PR

- Commit messages follow **Conventional Commits** style (`feat:`, `fix:`, `docs:`, etc.).
- The PR must pass required checks (lint/test) before merging.
- Resolve all review conversations before merging.

## Versioning & release (automatic)

Versioning is managed by **release-please** (`.github/workflows/release-please.yml`): it reads
Conventional Commits landing on `main`, maintains a **"release PR"** that updates
`package.json` + `CHANGELOG.md`, and on merge creates the **tag** and **GitHub Release**. Do not
bump versions manually.

- `feat:` → bump **minor**, `fix:` → bump **patch**, `feat!:`/`BREAKING CHANGE:` → bump major
  (pre-1.0: minor). `docs/chore/refactor/test` do not release.
- **Important**: because we merge via **squash**, the **PR title** becomes the commit message on
  `main` — so the PR title **must** be a valid Conventional Commit (e.g., `feat(context): ...`),
  otherwise release-please ignores it.

## Migrations

SQLite migrations are **append-only** and numbered `NNN_name.sql`. The number is a shared
sequential resource: parallel branches can pick the same number and collide. A test
(`server/db/migrate.naming.test.ts`) fails in CI on duplicates/gaps. If two branches end up with
the same `NNN`, the **second** PR to land must renumber its migration to the next available
number.

## Checklist before opening the PR

- [ ] `npm run lint` clean
- [ ] `npm run test:run` green
- [ ] Branch up-to-date with `main` (no conflicts)
- [ ] PR title in **Conventional Commits** (guides automatic versioning)
- [ ] PR description with what/why + how to test

---

For tests and code conventions, see [`docs/development.md`](docs/development.md).
