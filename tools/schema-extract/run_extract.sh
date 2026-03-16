#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$SCRIPT_DIR/sql"
OUTPUT_BASE="$SCRIPT_DIR/output"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
RUN_DIR="$OUTPUT_BASE/$TIMESTAMP"
COMBINED_OUT="$RUN_DIR/all_combined.txt"

# ── Connection mode ─────────────────────────────────────────────────────
# When DATABASE_URL is set, pass it via --dbname to psql/pg_dump so that
# individual PG* env-vars are not required.  Otherwise fall back to the
# standard PG* environment variables.
PSQL_CONN_ARGS=()
PGDUMP_CONN_ARGS=()

if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL_CONN_ARGS=(--dbname "$DATABASE_URL")
  PGDUMP_CONN_ARGS=(--dbname "$DATABASE_URL")
  CONN_LABEL="DATABASE_URL"
else
  # Require individual PG* vars when DATABASE_URL is absent
  for var in PGHOST PGUSER PGPASSWORD PGDATABASE; do
    if [[ -z "${!var:-}" ]]; then
      echo "Error: neither DATABASE_URL nor '$var' is set." >&2
      exit 1
    fi
  done
  export PGPORT="${PGPORT:-5432}"
  CONN_LABEL="${PGHOST}:${PGPORT}"
fi

export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-30}"

run_query() {
  local sql_file="$1"
  local output_file="$2"
  local title="$3"

  echo "[$(date -Iseconds)] Running: $title" | tee -a "$COMBINED_OUT"
  psql \
    "${PSQL_CONN_ARGS[@]}" \
    --no-psqlrc \
    --set ON_ERROR_STOP=1 \
    --file "$sql_file" >"$output_file" 2>>"$COMBINED_OUT"

  {
    echo
    echo "==== $title ===="
    cat "$output_file"
  } >>"$COMBINED_OUT"
}

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: 'psql' is required but not found in PATH." >&2
  exit 1
fi

mkdir -p "$RUN_DIR"

{
  echo "Schema extraction started at: $(date -Iseconds)"
  echo "Connection: ${CONN_LABEL}"
  echo "SSL mode: ${PGSSLMODE}"
  echo "Connect timeout: ${PGCONNECT_TIMEOUT}s"
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "Host: ${PGHOST}"
    echo "Port: ${PGPORT}"
    echo "User: ${PGUSER}"
    echo "Database: ${PGDATABASE}"
  fi
  echo
} >"$COMBINED_OUT"

# ── Connectivity pre-check ──────────────────────────────────────────────
if ! psql "${PSQL_CONN_ARGS[@]}" --no-psqlrc -c "SELECT 1" >/dev/null 2>"$RUN_DIR/precheck_err.txt"; then
  echo "Error: cannot connect to ${CONN_LABEL} – aborting extraction." | tee -a "$COMBINED_OUT"
  if [ -s "$RUN_DIR/precheck_err.txt" ]; then
    echo "psql error output:" | tee -a "$COMBINED_OUT"
    cat "$RUN_DIR/precheck_err.txt" | tee -a "$COMBINED_OUT"
  fi
  exit 1
fi

if command -v pg_dump >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] Running: schema_dump.sql" | tee -a "$COMBINED_OUT"
  if pg_dump \
    "${PGDUMP_CONN_ARGS[@]}" \
    --schema-only \
    --no-owner \
    --no-privileges \
    --file "$RUN_DIR/schema_dump.sql" 2>&1 | tee -a "$COMBINED_OUT"; then
    {
      echo
      echo "==== schema_dump.sql generated ===="
      echo "Path: $RUN_DIR/schema_dump.sql"
    } >>"$COMBINED_OUT"
  else
    echo "Warning: pg_dump failed – continuing with psql queries." | tee -a "$COMBINED_OUT"
  fi
else
  echo "[$(date -Iseconds)] Skipping schema_dump.sql (pg_dump not found)" | tee -a "$COMBINED_OUT"
fi

run_query "$SQL_DIR/tables.sql" "$RUN_DIR/tables.txt" "tables.txt"
run_query "$SQL_DIR/functions.sql" "$RUN_DIR/functions.sql" "functions.sql"
run_query "$SQL_DIR/triggers.sql" "$RUN_DIR/triggers.sql" "triggers.sql"
run_query "$SQL_DIR/policies.sql" "$RUN_DIR/policies.sql" "policies.sql"
run_query "$SQL_DIR/indexes.sql" "$RUN_DIR/indexes.sql" "indexes.sql"
run_query "$SQL_DIR/views.sql" "$RUN_DIR/views.sql" "views.sql"

echo "" | tee -a "$COMBINED_OUT"
echo "Extraction complete." | tee -a "$COMBINED_OUT"
echo "Output directory: $RUN_DIR" | tee -a "$COMBINED_OUT"
