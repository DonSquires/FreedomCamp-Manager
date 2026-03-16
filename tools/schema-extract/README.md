# Schema Extract Tooling

## Purpose

Extract the Postgres / Supabase schema (tables, columns, functions, triggers,
policies, indexes, views) and generate TypeScript types that match the live
database — ensuring the UI and DB stay correctly wired.

## How it works — two complementary strategies

### Strategy 1 — Supabase Management API (live schema)

Uses the **Supabase CLI** (`supabase gen types`, `supabase inspect db`) to query
the hosted database through the **Management API** (HTTPS, no direct Postgres
connection needed).

| What it needs | How to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase Dashboard → Account → Access tokens |
| `SUPABASE_PROJECT_REF` | Supabase Dashboard → Project Settings → General |
| `SUPABASE_DB_PASSWORD` *(optional — needed for `inspect db`)* | Project Settings → Database |

**Outputs:**

- `tools/schema-extract/output/live/database.ts` — generated TypeScript types
- `tools/schema-extract/output/live/type_drift.diff` — diff vs committed `src/types/database.ts` (if any drift)
- `tools/schema-extract/output/live/table_sizes.txt`, `index_sizes.txt` — live stats

### Strategy 2 — Local migration replay (no secrets needed)

Spins up an **ephemeral PostgreSQL container** (Docker), applies every committed
migration from `supabase/migrations/`, then runs `pg_dump` + SQL queries against
the local database.

| What it needs | Notes |
|---|---|
| Docker | Pre-installed on GHA runners and most dev machines |
| `psql` | Standard PostgreSQL client |

**Outputs** (timestamped directory):

- `tools/schema-extract/output/<timestamp>/schema_dump.sql`
- `tools/schema-extract/output/<timestamp>/tables.txt`
- `tools/schema-extract/output/<timestamp>/functions.sql`
- `tools/schema-extract/output/<timestamp>/triggers.sql`
- `tools/schema-extract/output/<timestamp>/policies.sql`
- `tools/schema-extract/output/<timestamp>/indexes.sql`
- `tools/schema-extract/output/<timestamp>/views.sql`
- `tools/schema-extract/output/<timestamp>/all_combined.txt`

## Important safety notes

- This tooling never writes to your production database.
- Do NOT commit DB credentials to the repo.
- The migration-replay approach is 100% local and needs no external access.

## How to run locally

### Option A — Generate types from live Supabase (recommended for type sync)

```bash
# Install Supabase CLI: https://supabase.com/docs/guides/cli/getting-started
supabase gen types typescript \
  --project-id "$SUPABASE_PROJECT_REF" \
  --schema public \
  > src/types/database.ts
```

Requires `SUPABASE_ACCESS_TOKEN` in your environment.

### Option B — Migration replay (recommended for full schema inspection)

```bash
chmod +x tools/schema-extract/extract_via_migrations.sh
./tools/schema-extract/extract_via_migrations.sh
```

Requires Docker and `psql`. No credentials needed — uses an ephemeral local
PostgreSQL container.

### Option C — Direct database connection (legacy)

If you have direct access to a PostgreSQL instance:

```bash
DATABASE_URL="postgresql://user:password@host:port/dbname?sslmode=require" \
  ./tools/schema-extract/run_extract.sh
```

**Note:** Direct connections to Supabase (`db.*.supabase.co`) resolve to IPv6
which is unreachable from GitHub Actions. Use Option A or B for CI.

## GitHub Action

- Workflow: `.github/workflows/schema-extract.yml` (also available in merge_all.yml)
- Trigger: `workflow_dispatch` only (manual)
- Both strategies run automatically:
  - Strategy 1 runs if `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` are set
  - Strategy 2 always runs (no secrets needed)

## If you want results attached to a PR

- Run locally and attach the output directory to the PR, or
- Dispatch the workflow with "Push generated output to a new branch" enabled

## Troubleshooting

| Problem | Solution |
|---|---|
| CI: `Tenant or user not found` | This was the old approach. The new workflow uses the Management API instead of direct DB connections. |
| CI: `Network is unreachable` (IPv6) | Same as above — no longer an issue with the new approach. |
| Local: Docker not available | Use Option A (Supabase CLI) or Option C (direct connection) instead. |
| Local: `psql` not found | Install PostgreSQL client tools (`apt install postgresql-client` / `brew install libpq`). |
| Migration replay: some migrations fail | Non-fatal. Some migrations may reference Supabase extensions not in vanilla PostgreSQL. Check the log for details. |
