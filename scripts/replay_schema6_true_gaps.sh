#!/usr/bin/env bash
set -euo pipefail

# Replays only canonical migrations needed to restore Schema Extract #6 true-gap keep tables.
# Requires a privileged Postgres URL.

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to a Postgres connection string}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

MIGRATIONS=(
  "$ROOT_DIR/supabase/migrations/20260219000002_evidence_integrity_and_legal_compliance.sql"
  "$ROOT_DIR/supabase/migrations/20260220000005_core_pipeline_rebuild.sql"
  "$ROOT_DIR/supabase/migrations/20260302000003_patrol_checkpoints.sql"
  "$ROOT_DIR/supabase/migrations/20260302000004_privacy_curtain.sql"
)

for file in "${MIGRATIONS[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing migration file: $file" >&2
    exit 1
  fi
done

echo "Applying canonical migrations for Schema #6 true-gap tables..."
for file in "${MIGRATIONS[@]}"; do
  echo "- $file"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$file"
done

echo "Verifying expected tables..."
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -Atc "
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'enforcement_cases',
    'enforcement_case_events',
    'patrol_checkpoints',
    'checkpoint_visits',
    'incident_attachments',
    'person_vehicle_links',
    'privacy_access_log',
    'retention_policies'
  )
ORDER BY table_name;
"

echo "Done."
