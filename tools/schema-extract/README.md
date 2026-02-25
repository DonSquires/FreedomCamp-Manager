# Schema Extract Tools

These tools extract the Supabase/PostgreSQL schema from a running database instance.
They produce SQL DDL files and structured query output that can be committed to a branch,
reviewed offline, or shared with team members and reviewers.

---

## Modes of operation

### 1. Local run

Run `run_extract.sh` on any machine that has `psql` (and optionally `pg_dump`) installed.

#### Required environment variables

| Variable      | Description                              |
|---------------|------------------------------------------|
| `PGHOST`      | Database host (e.g. `db.xxxx.supabase.co`) |
| `PGPORT`      | Database port (default `5432`)           |
| `PGUSER`      | Database user (use a **read-only** user; see note below) |
| `PGPASSWORD`  | Password for `PGUSER`                    |
| `PGDATABASE`  | Database name (usually `postgres`)       |

#### Optional environment variables

| Variable        | Description                                                  |
|-----------------|--------------------------------------------------------------|
| `SUPABASE_URL`  | Base URL of the Supabase project (for documentation only; not used by the script) |
| `OUTPUT_DIR`    | Override output directory (default: `tools/schema-extract/output`) |

> **Security note:** Always use a dedicated **read-only** database role for these
> extractions.  Never run the script with `postgres` or a role that has write
> privileges.  Create a read-only role in Supabase Dashboard → Database → Roles, or
> via:
> ```sql
> CREATE ROLE schema_reader WITH LOGIN PASSWORD 'strong-password';
> GRANT USAGE ON SCHEMA public TO schema_reader;
> GRANT SELECT ON ALL TABLES IN SCHEMA public TO schema_reader;
> ```

#### Example local run

```bash
export PGHOST=db.xxxx.supabase.co
export PGPORT=5432
export PGUSER=schema_reader
export PGPASSWORD='your-password-here'   # or use a ~/.pgpass entry
export PGDATABASE=postgres

cd tools/schema-extract
chmod +x run_extract.sh
./run_extract.sh
```

Output files are written to `tools/schema-extract/output/` with a timestamp prefix.

#### Pushing results to a branch

```bash
git checkout -b schema-extract/$(date +%Y%m%d)
git add tools/schema-extract/output/
git commit -m "chore: schema extract $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push origin HEAD
```

---

### 2. GitHub Action (optional, manual dispatch)

The workflow at `.github/workflows/extract-schema.yml` is triggered **only** via
manual dispatch (`workflow_dispatch`) and **only** runs when the following repository
secrets are configured:

| Secret        | Corresponds to env var |
|---------------|------------------------|
| `PGHOST`      | `PGHOST`               |
| `PGPORT`      | `PGPORT`               |
| `PGUSER`      | `PGUSER`               |
| `PGPASSWORD`  | `PGPASSWORD`           |
| `PGDATABASE`  | `PGDATABASE`           |

The workflow checks for the presence of these secrets before attempting a connection.
If any are absent the job exits gracefully with an explanatory message rather than
failing loudly.

After the extraction step the workflow commits the output files to the branch name
supplied as a workflow input (default: `schema-extract/YYYYMMDD`).

---

## Output files

| File                     | Contents                                    |
|--------------------------|---------------------------------------------|
| `schema_dump.sql`        | Full DDL from `pg_dump --schema-only`       |
| `tables.sql`             | Table & column definitions                  |
| `views.sql`              | View definitions                            |
| `functions.sql`          | Function DDL (`pg_get_functiondef`)         |
| `triggers.sql`           | Trigger DDL (`pg_get_triggerdef`)           |
| `policies.sql`           | Row-level security policies (`pg_policies`) |
| `indexes.sql`            | Index definitions (`pg_indexes`)            |

All files are placed in `tools/schema-extract/output/` which is listed in
`.gitignore` by default.  Remove or adjust that entry when you want to commit the
results.
