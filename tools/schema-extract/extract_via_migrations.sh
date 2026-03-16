#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# extract_via_migrations.sh — local migration-replay schema extraction
#
# Spins up an ephemeral PostgreSQL container, applies every committed
# Supabase migration, then runs pg_dump + the sql/ query scripts against
# the local DB.  No external secrets or network access required.
#
# Usage:
#   ./tools/schema-extract/extract_via_migrations.sh
#
# Requirements:
#   - Docker (or Podman symlinked as "docker")
#   - psql and pg_dump in $PATH
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_DIR="$SCRIPT_DIR/sql"
OUTPUT_BASE="$SCRIPT_DIR/output"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
RUN_DIR="$OUTPUT_BASE/$TIMESTAMP"
COMBINED_OUT="$RUN_DIR/all_combined.txt"

CONTAINER_NAME="schema-extract-pg-$$"
PG_PORT="${PG_PORT:-54399}"
PG_USER="postgres"
PG_PASS="postgres"
PG_DB="postgres"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── Pre-checks ──────────────────────────────────────────────────────────
for cmd in docker psql; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is required but not found in PATH." >&2
    exit 1
  fi
done

MIGRATION_DIR="$REPO_ROOT/supabase/migrations"
if [ ! -d "$MIGRATION_DIR" ]; then
  echo "Error: migration directory not found at $MIGRATION_DIR" >&2
  exit 1
fi

migration_count=$(find "$MIGRATION_DIR" -name '*.sql' | wc -l)
if [ "$migration_count" -eq 0 ]; then
  echo "Error: no migration files found in $MIGRATION_DIR" >&2
  exit 1
fi

mkdir -p "$RUN_DIR"

{
  echo "Schema extraction (migration-replay mode)"
  echo "Started at: $(date -Iseconds)"
  echo "Migration directory: $MIGRATION_DIR"
  echo "Migration count: $migration_count"
  echo ""
} >"$COMBINED_OUT"

# ── Start ephemeral PostgreSQL ──────────────────────────────────────────
echo "[$(date -Iseconds)] Starting ephemeral PostgreSQL container …" | tee -a "$COMBINED_OUT"

docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_DB="$PG_DB" \
  -p "127.0.0.1:${PG_PORT}:5432" \
  postgres:17-alpine >/dev/null

# Wait for PostgreSQL to become ready
echo "[$(date -Iseconds)] Waiting for PostgreSQL to accept connections …" | tee -a "$COMBINED_OUT"
for i in $(seq 1 30); do
  if PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
       --no-psqlrc -c "SELECT 1" >/dev/null 2>&1; then
    echo "[$(date -Iseconds)] PostgreSQL ready after ${i}s" | tee -a "$COMBINED_OUT"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: PostgreSQL did not become ready within 30 seconds" >&2
    exit 1
  fi
  sleep 1
done

# ── Enable common extensions that Supabase provides out-of-the-box ──────
echo "[$(date -Iseconds)] Enabling Supabase-standard extensions …" | tee -a "$COMBINED_OUT"
PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
  --no-psqlrc --set ON_ERROR_STOP=0 <<'EXTSQL' >>"$COMBINED_OUT" 2>&1
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "postgis" SCHEMA public;
-- Create auth schema stub (used by RLS policies)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT '00000000-0000-0000-0000-000000000000'::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT '{}'::jsonb;
$$;
-- Create storage schema stub
CREATE SCHEMA IF NOT EXISTS storage;
EXTSQL

# ── Apply migrations ───────────────────────────────────────────────────
echo "[$(date -Iseconds)] Applying $migration_count migrations …" | tee -a "$COMBINED_OUT"

applied=0
failed=0
for migration in $(find "$MIGRATION_DIR" -name '*.sql' | sort); do
  base="$(basename "$migration")"
  if PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
       --no-psqlrc --set ON_ERROR_STOP=0 \
       -f "$migration" >>"$COMBINED_OUT" 2>&1; then
    applied=$((applied + 1))
  else
    failed=$((failed + 1))
    echo "  ⚠ Migration failed (non-fatal): $base" | tee -a "$COMBINED_OUT"
  fi
done

echo "[$(date -Iseconds)] Migrations applied: $applied ok, $failed failed" | tee -a "$COMBINED_OUT"

# ── Run extraction queries ─────────────────────────────────────────────
run_query() {
  local sql_file="$1"
  local output_file="$2"
  local title="$3"

  echo "[$(date -Iseconds)] Running: $title" | tee -a "$COMBINED_OUT"
  PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
    --no-psqlrc \
    --set ON_ERROR_STOP=1 \
    --file "$sql_file" >"$output_file" 2>>"$COMBINED_OUT"

  {
    echo
    echo "==== $title ===="
    cat "$output_file"
  } >>"$COMBINED_OUT"
}

# pg_dump for full DDL
echo "[$(date -Iseconds)] Running: schema_dump.sql" | tee -a "$COMBINED_OUT"
if command -v pg_dump >/dev/null 2>&1; then
  PGPASSWORD="$PG_PASS" pg_dump -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
    --schema-only \
    --schema=public \
    --no-owner \
    --no-privileges \
    --file "$RUN_DIR/schema_dump.sql" 2>>"$COMBINED_OUT" || true
  echo "  → schema_dump.sql written" | tee -a "$COMBINED_OUT"
else
  echo "  → pg_dump not found, skipping schema_dump.sql" | tee -a "$COMBINED_OUT"
fi

run_query "$SQL_DIR/tables.sql" "$RUN_DIR/tables.txt" "tables.txt"
run_query "$SQL_DIR/functions.sql" "$RUN_DIR/functions.sql" "functions.sql"
run_query "$SQL_DIR/triggers.sql" "$RUN_DIR/triggers.sql" "triggers.sql"
run_query "$SQL_DIR/policies.sql" "$RUN_DIR/policies.sql" "policies.sql"
run_query "$SQL_DIR/indexes.sql" "$RUN_DIR/indexes.sql" "indexes.sql"
run_query "$SQL_DIR/views.sql" "$RUN_DIR/views.sql" "views.sql"

echo "" | tee -a "$COMBINED_OUT"
echo "Extraction complete (migration-replay mode)." | tee -a "$COMBINED_OUT"
echo "Output directory: $RUN_DIR" | tee -a "$COMBINED_OUT"
echo "Migrations: $applied applied, $failed failed" | tee -a "$COMBINED_OUT"
