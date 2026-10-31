# Contributing — repository workflow

This repo follows **gitflow**. `main` holds released code only and is protected; `develop` is
the integration branch every feature lands on. Every change lands via Pull Request approved by
the owner.

## Branches

| Branch | From | PR into | Usage |
|---|---|---|---|
| `main` | — | — | released code; tags and GitHub Releases come from here |
| `develop` | `main` | — | integration of finished features |
| `feature/<name>` | `develop` | `develop` | any change: features, fixes, docs, refactors, chores |
| `release/x.y.z` | `develop` | `main` | stabilize a release (fixes only), then ship it |
| `hotfix/<name>` | `main` | `main` | urgent fix to released code |

## Golden rules

1. **Never push directly to `main` or `develop`**; never open a feature PR against `main`.
2. Feature work starts from an up-to-date `develop` and ends in a **PR to `develop`**.
3. A PR can only be merged **after approval from @MichelePolo** (Code Owner) and green checks.
4. Feature PRs are merged via **squash**: one Conventional Commit per feature on `develop`.

## Feature flow

```bash
# 1. Sync to develop
git checkout develop
git pull

# 2. Branch off
git checkout -b feature/short-description

# 3. Work, small and frequent commits
git add -A && git commit -m "feat: ..."

# 4. Push and open the PR against develop
git push -u origin feature/short-description
gh pr create --base develop --fill

# 5. Wait for review from @MichelePolo. Apply feedback on the same branch.
# 6. Once merged (squash), the branch is deleted automatically.
```

## Release and hotfix flow

1. `git checkout -b release/x.y.z develop`, push, open a PR **`release/x.y.z` → `main`**. Only
   stabilization fixes go on the release branch.
2. Merged into `main`, the feature commits feed release-please, which opens its release PR on
   `main`; merging that PR creates the tag and the GitHub Release (see below).
3. Merge `main` back into `develop`, so the release commit and any release fixes reach it.

Hotfixes are the same with `hotfix/<name>` from `main`, then back into `develop`.

> **Merge method for release, hotfix and back-merge PRs: to be decided before the first
> release.** Classic gitflow joins these branches with merge commits (`--no-ff`), but `main`
> currently requires linear history and the repo disallows merge commits. Squash would collapse
> every feature into one commit (release-please would lose the individual `feat:`/`fix:`
> entries); "Rebase and merge" keeps them but rewrites their SHAs, so `main` and `develop`
> diverge after every release. Either allow merge commits for these PRs, or rebase-merge
> releases and re-point `develop` to `main` afterwards.

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
- **Important**: feature PRs are squash-merged, so the **PR title** becomes the commit message on
  `develop` (and later on `main`): it **must** be a valid Conventional Commit (e.g.,
  `feat(context): ...`), otherwise release-please ignores it.

## Migrations

SQLite migrations are **append-only** and numbered `NNN_name.sql`. The number is a shared
sequential resource: parallel branches can pick the same number and collide. A test
(`server/db/migrate.naming.test.ts`) fails in CI on duplicates/gaps. If two branches end up with
the same `NNN`, the **second** PR to land must renumber its migration to the next available
number.

## Checklist before opening the PR

- [ ] `npm run lint` clean
- [ ] `npm run test:run` green
- [ ] Branch up-to-date with `develop` (no conflicts)
- [ ] PR targets `develop` (features) — `main` only for `release/*` and `hotfix/*`
- [ ] PR title in **Conventional Commits** (guides automatic versioning)
- [ ] PR description with what/why + how to test

---

For tests and code conventions, see [`docs/development.md`](docs/development.md).
