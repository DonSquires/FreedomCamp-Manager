# Tooling Guide

This project supports local, non-global tooling binaries so contributors can run commands consistently in dev containers and locked-down environments.

## Supported Local Tool Paths

The scripts in this repo auto-detect tools in this order:

1. Repo-local: `.tools/bin/`
2. User-local: `/home/vscode/.local/bin/`
3. Workspace-local Bun: `/workspaces/.bun/bin/`

Current binaries used in this workspace:

- `.tools/bin/bun`
- `.tools/bin/supabase`

`/.tools` is ignored by git and should stay local.

## Bun Usage

Preferred wrapper:

```bash
scripts/use-bun.sh bun --version
scripts/use-bun.sh bun run build
scripts/use-bun.sh bun run lint
```

Direct invocation also works when Bun is on `PATH`:

```bash
bun run build
bun run lint
```

If `bun` is not found, use the wrapper above or install to a local path:

```bash
curl -fsSL https://bun.sh/install | BUN_INSTALL=/workspaces/.bun bash
```

## Supabase CLI Usage

The manual deploy script auto-detects `supabase` from `.tools/bin/supabase` before requiring a global install.

```bash
scripts/manual-supabase-deploy.sh functions
scripts/manual-supabase-deploy.sh db
scripts/manual-supabase-deploy.sh all
```

Required env vars:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF` (optional, defaults in script)
- `SUPABASE_DB_PASSWORD` (required for `db` or `all` modes)

## Quick Setup (One-time)

```bash
mkdir -p .tools/bin
# Place local bun and supabase binaries under .tools/bin
scripts/use-bun.sh bun --version
scripts/manual-supabase-deploy.sh functions
```

## Notes

- `git-lfs` is not available in this container by default; local LFS hooks may block `git push` unless bypassed.
- For this environment, use `git push --no-verify` only when needed to bypass missing local hooks.
