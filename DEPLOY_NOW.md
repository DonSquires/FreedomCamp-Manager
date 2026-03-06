# Deploy Now (CLI + GitHub Actions)

This runbook is the current fastest path for deployment in this repo.

## 1) Preflight

From repo root:

```bash
vercel --version
"$HOME/.local/bin/supabase" --version
GH_FORCE_TTY=0 gh auth status
```

If `gh auth status` is not logged in, run `gh auth login` first.

## 2) Required GitHub Secrets

The workflows in `.github/workflows/` require these secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`
- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`

You can set them from terminal:

```bash
GH_FORCE_TTY=0 gh secret set SUPABASE_ACCESS_TOKEN
GH_FORCE_TTY=0 gh secret set SUPABASE_DB_PASSWORD
GH_FORCE_TTY=0 gh secret set SUPABASE_PROJECT_REF

GH_FORCE_TTY=0 gh secret set PGHOST
GH_FORCE_TTY=0 gh secret set PGPORT
GH_FORCE_TTY=0 gh secret set PGUSER
GH_FORCE_TTY=0 gh secret set PGPASSWORD
GH_FORCE_TTY=0 gh secret set PGDATABASE
```

Each command prompts for the value securely.

## 3) Push This Branch First

The new workflows only exist after these files are committed and pushed:

- `.github/workflows/supabase-db-push.yml`
- `.github/workflows/schema-extract.yml`
- `tools/schema-extract/*`

## 4) Run Supabase Migration Workflow

Dispatch:

```bash
GH_FORCE_TTY=0 gh workflow run supabase-db-push.yml
```

Monitor latest run:

```bash
GH_FORCE_TTY=0 gh run list --workflow supabase-db-push.yml --limit 1
GH_FORCE_TTY=0 gh run watch
```

## 5) Run Schema Extract Workflow

Artifact only (recommended):

```bash
GH_FORCE_TTY=0 gh workflow run schema-extract.yml
```

Optional: push generated output to a branch:

```bash
GH_FORCE_TTY=0 gh workflow run schema-extract.yml -f push_results=true
```

Monitor latest run:

```bash
GH_FORCE_TTY=0 gh run list --workflow schema-extract.yml --limit 1
GH_FORCE_TTY=0 gh run watch
```

## 6) Optional Local Supabase Push (Manual)

Use this only when secrets/env are loaded locally:

```bash
"$HOME/.local/bin/supabase" link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
"$HOME/.local/bin/supabase" db push
```

## 7) Vercel Deployment (Token-Based)

Set token in environment, then deploy non-interactively:

```bash
export VERCEL_TOKEN="<token>"
vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```
