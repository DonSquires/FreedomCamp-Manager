#!/usr/bin/env bash
# migration-utils.sh — shared helper functions for Supabase migration management.
# Source this file from other scripts: source "$(dirname "$0")/migration-utils.sh"

set -euo pipefail

# ---------------------------------------------------------------------------
# Colour output helpers (disabled when not a tty)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  RED=''; YELLOW=''; GREEN=''; BLUE=''; NC=''
fi

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# require_env VAR …
#   Abort with a clear message if any of the named environment variables
#   are unset or empty.
# ---------------------------------------------------------------------------
require_env() {
  local missing=0
  for var in "$@"; do
    if [ -z "${!var:-}" ]; then
      log_error "Required environment variable not set: $var"
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

# ---------------------------------------------------------------------------
# supabase_link
#   Link the CLI to the project referenced by SUPABASE_PROJECT_REF.
# ---------------------------------------------------------------------------
supabase_link() {
  require_env SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF
  log_info "Linking Supabase CLI to project $SUPABASE_PROJECT_REF …"
  supabase link \
    --project-ref "$SUPABASE_PROJECT_REF" \
    --password    "$SUPABASE_DB_PASSWORD"
  log_success "Project linked."
}

# ---------------------------------------------------------------------------
# repair_known_drift_versions
#   Revert short-form legacy migration versions that exist on the remote
#   but do not map to any local migration file.  Safe and idempotent.
# ---------------------------------------------------------------------------
KNOWN_DRIFT_VERSIONS=(
  20250127
  20260309
  20260312
  20260313
  20260316
  20260320
)

repair_known_drift_versions() {
  log_info "Repairing known drift versions: ${KNOWN_DRIFT_VERSIONS[*]}"
  for version in "${KNOWN_DRIFT_VERSIONS[@]}"; do
    supabase migration repair --status reverted "$version" 2>/dev/null \
      && log_success "  Reverted $version" \
      || log_warn    "  $version not found on remote (OK)"
  done
}

# ---------------------------------------------------------------------------
# repair_versions_from_log LOG_FILE STATUS
#   Parse a supabase CLI error log for version numbers that appear in a
#   "supabase migration repair --status <STATUS> <versions>" suggestion and
#   apply that repair.  STATUS is typically "reverted" or "applied".
# ---------------------------------------------------------------------------
repair_versions_from_log() {
  local log_file="$1"
  local status="$2"

  local versions
  versions=$(grep -oE "supabase migration repair --status ${status} [0-9 ]+" "$log_file" \
             | sed -E "s/^supabase migration repair --status ${status} //" \
             | head -n1)

  if [ -z "${versions:-}" ]; then
    log_warn "No '${status}' repair hints found in log."
    return 0
  fi

  log_info "Repairing versions as ${status}: $versions"
  # shellcheck disable=SC2086
  supabase migration repair --status "$status" $versions || true
  log_success "Repair step completed."
}

# ---------------------------------------------------------------------------
# push_with_retry [MAX_ATTEMPTS]
#   Run `supabase db push`, automatically handling the two most common drift
#   error classes.  Returns 0 on success, 1 on exhaustion.
# ---------------------------------------------------------------------------
push_with_retry() {
  local max="${1:-3}"
  local log_file
  log_file="$(mktemp)"

  for attempt in $(seq 1 "$max"); do
    log_info "db push attempt $attempt / $max …"

    if supabase db push 2>&1 | tee "$log_file"; then
      log_success "db push succeeded on attempt $attempt."
      rm -f "$log_file"
      return 0
    fi

    local handled=false

    # Case 1: local migrations found before remote tail → mark as applied.
    if grep -q "Found local migration files to be inserted before the last migration on remote database" "$log_file"; then
      log_warn "Out-of-order local migrations detected. Marking as applied …"
      grep -oE 'supabase/migrations/[0-9][^[:space:]]*\.sql' "$log_file" \
        | sed 's#supabase/migrations/##; s#\.sql$##' \
        | awk -F'_' '{print $1}' \
        | sort -u \
        | while read -r version; do
            [ -n "$version" ] || continue
            log_info "  Marking applied: $version"
            supabase migration repair --status applied "$version" || true
          done
      handled=true
    fi

    # Case 2: remote has versions not in local directory → revert them.
    if grep -q "Remote migration versions not found in local migrations directory" "$log_file"; then
      repair_versions_from_log "$log_file" "reverted"
      handled=true
    fi

    if [ "$handled" = false ]; then
      log_error "Push failed for an unrecognised reason:"
      cat "$log_file"
      rm -f "$log_file"
      return 1
    fi
  done

  log_warn "push_with_retry exhausted $max attempts."
  rm -f "$log_file"
  return 1
}

# ---------------------------------------------------------------------------
# push_include_all_with_repair
#   Final-resort push using --include-all, with one additional repair pass
#   if remote-version drift is still reported.
# ---------------------------------------------------------------------------
push_include_all_with_repair() {
  local log_file
  log_file="$(mktemp)"

  log_info "Attempting supabase db push --include-all …"
  if supabase db push --include-all 2>&1 | tee "$log_file"; then
    log_success "db push --include-all succeeded."
    rm -f "$log_file"
    return 0
  fi

  if grep -q "Remote migration versions not found in local migrations directory" "$log_file"; then
    log_warn "Remote-only versions still present after --include-all. Applying repair …"
    repair_versions_from_log "$log_file" "reverted"
    log_info "Retrying supabase db push --include-all …"
    if supabase db push --include-all 2>&1 | tee "$log_file"; then
      log_success "db push --include-all succeeded after post-repair."
      rm -f "$log_file"
      return 0
    fi
  fi

  log_error "supabase db push --include-all failed:"
  cat "$log_file"
  rm -f "$log_file"
  return 1
}

# ---------------------------------------------------------------------------
# show_migration_list
#   Print the current remote migration state.
# ---------------------------------------------------------------------------
show_migration_list() {
  log_info "Current migration state:"
  supabase migration list || true
}
