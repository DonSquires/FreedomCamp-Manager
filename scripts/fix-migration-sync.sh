#!/usr/bin/env bash
# fix-migration-sync.sh — resolves Supabase migration history drift between
# local files and the remote database.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN='sbp_...'
#   export SUPABASE_DB_PASSWORD='...'
#   export SUPABASE_PROJECT_REF='...'
#   bash scripts/fix-migration-sync.sh
#
# The script is safe to re-run.  All repair operations are idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=migration-utils.sh
source "$SCRIPT_DIR/migration-utils.sh"

# ---------------------------------------------------------------------------
# 1. Verify required environment variables
# ---------------------------------------------------------------------------
require_env SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF

# ---------------------------------------------------------------------------
# 2. Ensure the Supabase CLI is available
# ---------------------------------------------------------------------------
if ! command -v supabase &>/dev/null; then
  log_error "supabase CLI not found. Install it first:"
  log_error "  https://supabase.com/docs/guides/cli/getting-started"
  exit 1
fi

log_info "supabase CLI version: $(supabase --version 2>&1 || echo 'unknown')"

# ---------------------------------------------------------------------------
# 3. Link to the remote project
# ---------------------------------------------------------------------------
supabase_link

# ---------------------------------------------------------------------------
# 4. Show current migration state before making any changes
# ---------------------------------------------------------------------------
log_info "--- Migration state BEFORE repair ---"
show_migration_list

# ---------------------------------------------------------------------------
# 5. Revert all known short-form drift versions
#    These are date-only entries (e.g. 20260313) that can appear on the remote
#    when a migration file was renamed or split into timestamped variants.
# ---------------------------------------------------------------------------
repair_known_drift_versions

# ---------------------------------------------------------------------------
# 6. Attempt a normal push (up to 3 retries with automatic error handling)
# ---------------------------------------------------------------------------
if push_with_retry 3; then
  log_info "--- Migration state AFTER push ---"
  show_migration_list
  log_success "Migration sync complete."
  exit 0
fi

# ---------------------------------------------------------------------------
# 7. Fall back to --include-all with one additional repair pass
# ---------------------------------------------------------------------------
log_warn "Standard push did not converge. Trying --include-all …"

if push_include_all_with_repair; then
  log_info "--- Migration state AFTER include-all push ---"
  show_migration_list
  log_success "Migration sync complete (via --include-all)."
  exit 0
fi

# ---------------------------------------------------------------------------
# 8. All attempts exhausted — print diagnostics and exit with failure
# ---------------------------------------------------------------------------
log_error "All migration sync attempts failed."
log_error ""
log_error "Manual recovery steps:"
log_error "  1. Run: supabase migration list"
log_error "  2. Identify versions present on remote but absent locally."
log_error "  3. Revert them: supabase migration repair --status reverted <version>"
log_error "  4. Pull remote schema: supabase db pull"
log_error "  5. Commit any new local files and retry: supabase db push"
log_error ""
log_error "See docs/MIGRATION_TROUBLESHOOTING.md for detailed guidance."
exit 1
