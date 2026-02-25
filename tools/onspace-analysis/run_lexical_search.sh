#!/usr/bin/env bash
# =============================================================================
# run_lexical_search.sh – Run ripgrep / grep searches across the Onspace
# codebase to locate symbols, table names, edge-function names, and env vars
# that are relevant to the FreedomCamp-Manager integration.
#
# Usage:
#   export ONSPACE_DIR=/path/to/onspace-repo-or-unzipped-directory
#   ./run_lexical_search.sh
#
# Optional:
#   OUTPUT_FILE=/path/to/results.txt ./run_lexical_search.sh
#
# Requires: ripgrep (rg) or grep.  ripgrep is strongly preferred for speed
# and context display; the script falls back to grep if rg is not available.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info() { printf '[INFO]  %s\n' "$*"; }
die()  { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------
ONSPACE_DIR="${ONSPACE_DIR:-}"
[ -n "$ONSPACE_DIR" ] || die "ONSPACE_DIR is not set.  Point it at the Onspace source tree."
[ -d "$ONSPACE_DIR" ] || die "ONSPACE_DIR '$ONSPACE_DIR' is not a directory."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="${OUTPUT_FILE:-${OUTPUT_DIR}/lexical_results.txt}"

# ---------------------------------------------------------------------------
# Choose search tool
# ---------------------------------------------------------------------------
if command -v rg >/dev/null 2>&1; then
    SEARCH_CMD="rg"
    info "Using ripgrep (rg)"
else
    SEARCH_CMD="grep"
    info "ripgrep not found – falling back to grep (slower, less context)"
fi

# ---------------------------------------------------------------------------
# Search function
# ---------------------------------------------------------------------------
# Usage: do_search <label> <pattern>
do_search() {
    local label="$1"
    local pattern="$2"
    {
        echo ""
        echo "###########################################################"
        echo "# SEARCH: $label"
        echo "# PATTERN: $pattern"
        echo "###########################################################"
        if [ "$SEARCH_CMD" = "rg" ]; then
            rg --color=never -n --context 2 "$pattern" "$ONSPACE_DIR" 2>/dev/null || true
        else
            grep --color=never -rn --include='*' "$pattern" "$ONSPACE_DIR" 2>/dev/null || true
        fi
    } | tee -a "$OUTPUT_FILE"
}

# ---------------------------------------------------------------------------
# Initialise output file
# ---------------------------------------------------------------------------
{
    echo "# Onspace Lexical Search Results"
    echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# Source dir: $ONSPACE_DIR"
} > "$OUTPUT_FILE"

info "Writing results to $OUTPUT_FILE"

# ---------------------------------------------------------------------------
# Searches – extend this list as new symbols are identified
# ---------------------------------------------------------------------------

# --- Edge function / worker names ---
do_search "edge-fn: process-vehicle-enrichment"  "process-vehicle-enrichment"
do_search "edge-fn: vehicle-enrichment"          "vehicle.enrichment"
do_search "edge-fn: calculate-vehicle-compliance" "calculate.vehicle.compliance"
do_search "edge-fn: breach-detection"            "breach.detection"
do_search "edge-fn: observations"                "observations"

# --- Database table / view names ---
do_search "table: observations_v2"               "observations_v2"
do_search "table: vehicle_enrichment_jobs"        "vehicle_enrichment_jobs"
do_search "table: canonical_vehicles"             "canonical_vehicles"
do_search "table: compliance_results"             "compliance_results"
do_search "table: breach_alerts"                  "breach_alerts"
do_search "table: vehicles"                       "\"vehicles\""
do_search "table: patrols"                        "\"patrols\""
do_search "table: patrol_observations"            "patrol_observations"

# --- Environment variable names ---
do_search "env: SUPABASE_URL"                    "SUPABASE_URL"
do_search "env: SUPABASE_ANON_KEY"              "SUPABASE_ANON_KEY"
do_search "env: SUPABASE_SERVICE_ROLE_KEY"      "SUPABASE_SERVICE_ROLE_KEY"
do_search "env: DATABASE_URL"                    "DATABASE_URL"
do_search "env: ONSPACE_*"                       "ONSPACE_"

# --- Generic patterns ---
do_search "supabase client calls"                "supabase\.from("
do_search "rpc calls"                            "\.rpc("
do_search "storage bucket references"            "storage\.from("
do_search "edge-function invocations"            "functions\.invoke("

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
info "Lexical search complete."
info "Results: $OUTPUT_FILE"
MATCH_COUNT=$(grep -c '^###' "$OUTPUT_FILE" || true)
info "Sections searched: $MATCH_COUNT"
