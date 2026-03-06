#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$SCRIPT_DIR/sql"
OUTPUT_BASE="$SCRIPT_DIR/output"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
RUN_DIR="$OUTPUT_BASE/$TIMESTAMP"
COMBINED_OUT="$RUN_DIR/all_combined.txt"

require_env() {
  local var_name="$1"
  if [[ -z "${!var_name:-}" ]]; then
    echo "Error: required environment variable '$var_name' is not set." >&2
    exit 1
  fi
}

run_query() {
  local sql_file="$1"
  local output_file="$2"
  local title="$3"

  echo "[$(date -Iseconds)] Running: $title" | tee -a "$COMBINED_OUT"
  psql \
    --no-psqlrc \
    --set ON_ERROR_STOP=1 \
    --file "$sql_file" >"$output_file" 2>>"$COMBINED_OUT"

  {
    echo
    echo "==== $title ===="
    cat "$output_file"
  } >>"$COMBINED_OUT"
}

require_env "PGHOST"
require_env "PGUSER"
require_env "PGPASSWORD"
require_env "PGDATABASE"

export PGPORT="${PGPORT:-5432}"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: 'psql' is required but not found in PATH." >&2
  exit 1
fi

mkdir -p "$RUN_DIR"

{
  echo "Schema extraction started at: $(date -Iseconds)"
  echo "Host: ${PGHOST}"
  echo "Port: ${PGPORT}"
  echo "User: ${PGUSER}"
  echo "Database: ${PGDATABASE}"
  echo
} >"$COMBINED_OUT"

if command -v pg_dump >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] Running: schema_dump.sql" | tee -a "$COMBINED_OUT"
  pg_dump \
    --schema-only \
    --no-owner \
    --no-privileges \
    --file "$RUN_DIR/schema_dump.sql" 2>>"$COMBINED_OUT"
  {
    echo
    echo "==== schema_dump.sql generated ===="
    echo "Path: $RUN_DIR/schema_dump.sql"
  } >>"$COMBINED_OUT"
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
