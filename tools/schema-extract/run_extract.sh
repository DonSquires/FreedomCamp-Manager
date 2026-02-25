#!/bin/sh
# =============================================================================
# run_extract.sh – Extract schema from a Supabase/PostgreSQL database
#
# Usage:
#   export PGHOST=db.xxxx.supabase.co
#   export PGPORT=5432
#   export PGUSER=schema_reader
#   export PGPASSWORD='secret'   # or use ~/.pgpass
#   export PGDATABASE=postgres
#   ./run_extract.sh
#
# Optional:
#   OUTPUT_DIR=/path/to/dir ./run_extract.sh   # override output location
#
# The script exits with a non-zero status on any error.
# It never echoes PGPASSWORD to stdout/stderr.
# =============================================================================
set -eu

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '[INFO]  %s\n' "$*"; }
warn()  { printf '[WARN]  %s\n' "$*" >&2; }
die()   { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Validate required environment variables
# ---------------------------------------------------------------------------
for var in PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE; do
    eval "val=\${${var}:-}"
    [ -n "$val" ] || die "Required environment variable \$$var is not set."
done

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/output}"

mkdir -p "$OUTPUT_DIR"
info "Output directory: $OUTPUT_DIR"
info "Timestamp:        $TIMESTAMP"

# Export connection variables so psql/pg_dump pick them up automatically.
# PGPASSWORD is already exported; we just ensure the others are too.
export PGHOST PGPORT PGUSER PGDATABASE
# PGPASSWORD must already be in the environment; we do NOT echo it.

PSQL_OPTS="-v ON_ERROR_STOP=1 --no-psqlrc --tuples-only --no-align -F$'\t'"

# ---------------------------------------------------------------------------
# 1. Full schema dump via pg_dump (optional but preferred)
# ---------------------------------------------------------------------------
DUMP_FILE="${OUTPUT_DIR}/${TIMESTAMP}_schema_dump.sql"
if command -v pg_dump >/dev/null 2>&1; then
    info "Running pg_dump …"
    pg_dump \
        --schema-only \
        --no-owner \
        --no-privileges \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d "$PGDATABASE" \
        -f "$DUMP_FILE" \
        || die "pg_dump failed."
    info "Wrote $DUMP_FILE"
else
    warn "pg_dump not found – skipping full DDL dump."
fi

# ---------------------------------------------------------------------------
# Helper: run a named section of queries.sql and save to a file
# ---------------------------------------------------------------------------
run_section() {
    section="$1"   # label used in \echo inside queries.sql, e.g. "tables"
    out_file="${OUTPUT_DIR}/${TIMESTAMP}_${section}.txt"

    info "Extracting ${section} …"

    # Build a per-section SQL file that only contains the relevant query.
    # We rely on the section markers already present in queries.sql.
    # Simpler approach: run the whole queries.sql and capture everything; then
    # the caller splits by section label.  Here we run the full file and save
    # one combined output, then individual sections are extracted below.
    :
}

# ---------------------------------------------------------------------------
# 2. Run queries.sql and capture full output
# ---------------------------------------------------------------------------
FULL_OUTPUT="${OUTPUT_DIR}/${TIMESTAMP}_full_query_output.txt"
info "Running queries.sql …"
psql \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    --no-psqlrc \
    --no-align \
    -F "	" \
    -f "${SCRIPT_DIR}/queries.sql" \
    > "$FULL_OUTPUT" 2>&1 \
    || die "psql failed – check credentials and network access."
info "Wrote $FULL_OUTPUT"

# ---------------------------------------------------------------------------
# 3. Split output into individual section files
# ---------------------------------------------------------------------------
split_section() {
    label="$1"   # matches the string printed by \echo in queries.sql
    dest="${OUTPUT_DIR}/${TIMESTAMP}_${label}.txt"
    # Extract lines between the section header and the next header (or EOF).
    awk -v lbl="-- ${label} --" '
        /^-- [a-z]+ --$/ { if (found) exit; if ($0 == lbl) { found=1; next } }
        found { print }
    ' "$FULL_OUTPUT" > "$dest"
    info "Wrote $dest"
}

for section in tables views functions triggers policies indexes; do
    split_section "$section"
done

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
info "Schema extraction complete.  Files in: $OUTPUT_DIR"
