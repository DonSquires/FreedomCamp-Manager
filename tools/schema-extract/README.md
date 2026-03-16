# Schema Extract Tooling

## Purpose

Provide safe, idempotent scripts to extract the Postgres / Supabase schema and definitions (tables, columns, functions, triggers, policies, indexes, views).

Designed to be run locally (recommended) or via an opt-in GitHub Action that runs only when you manually dispatch it and add DB secrets.

## Important safety notes

- This tooling never writes to your database. It only reads schema and writes output into `tools/schema-extract/output/`.
- Do NOT commit DB credentials to the repo. Use environment variables or repository secrets for the Action.
- Use a read-only, least-privileged DB user when possible.
- After using any temporary credentials, rotate them.

## Modes

- **Local run (recommended):** Run the extraction script locally with environment variables:
  - `DATABASE_URL` — a full PostgreSQL connection string, **or**
  - `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
  - Optional: `SUPABASE_URL` (for reference only) — not required for extraction.
- **GitHub Action (opt-in):** Configure **one** of the following sets of repository secrets:
  - **Option A (recommended):** `DATABASE_URL` — copy the full URI from Supabase Dashboard → Project Settings → Database → Connection string (use the *Session mode* pooler string for best compatibility).
  - **Option B:** `PGHOST` + `PGUSER` + `PGPASSWORD` + `PGDATABASE` (+ optional `PGPORT`)
  - **Option C:** `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` — the workflow derives a pooler connection URL from these. This may not work if the pooler hostname differs from the default (`aws-0-ap-southeast-2`); prefer Option A.
  - If no credentials are configured the workflow **fails** with instructions.
  - Workflow file: `.github/workflows/schema-extract.yml`
  - Trigger type: `workflow_dispatch` only

## How to run locally

1. Ensure `psql` is installed and in your `PATH`. `pg_dump` is optional but recommended for a full schema dump.
2. Make the script executable:

   ```bash
   chmod +x tools/schema-extract/run_extract.sh
   ```

3. Run with a connection string:

   ```bash
   DATABASE_URL="postgresql://user:password@host:port/dbname?sslmode=require" ./tools/schema-extract/run_extract.sh
   ```

   Or with individual PG variables:

   ```bash
   PGHOST=<host> PGPORT=5432 PGUSER=<user> PGPASSWORD=<password> PGDATABASE=<db> ./tools/schema-extract/run_extract.sh
   ```

## Outputs

- `tools/schema-extract/output/<timestamp>/schema_dump.sql` (if `pg_dump` available)
- `tools/schema-extract/output/<timestamp>/tables.txt`
- `tools/schema-extract/output/<timestamp>/functions.sql`
- `tools/schema-extract/output/<timestamp>/triggers.sql`
- `tools/schema-extract/output/<timestamp>/policies.sql`
- `tools/schema-extract/output/<timestamp>/indexes.sql`
- `tools/schema-extract/output/<timestamp>/views.sql`
- `tools/schema-extract/output/<timestamp>/all_combined.txt` (combined run output)

## If you want results attached to a PR

- Run locally and attach the `output/<timestamp>/` directory to the PR as files, or
- Enable the Action and manually dispatch it with secrets; the workflow uploads an artifact, and can optionally push results to a branch for review.

## Troubleshooting

- If `psql`/`pg_dump` are unavailable, install PostgreSQL client tools (`apt`, `brew`, etc.).
- The script uses `PGPASSWORD` or `.pgpass` (if present) and never echoes the password.
