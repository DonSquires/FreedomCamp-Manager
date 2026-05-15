#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
fi

echo "[bob-migrations] repo: $ROOT_DIR"

if ! command -v supabase >/dev/null 2>&1; then
  echo "[bob-migrations] supabase CLI is required on PATH"
  exit 1
fi

DB_URL="${SUPABASE_DB_URL:-}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}"

if [[ "$CHECK_ONLY" == "true" ]]; then
  echo "[bob-migrations] check mode"
  echo "  SUPABASE_DB_URL set: $([[ -n "$DB_URL" ]] && echo yes || echo no)"
  echo "  SUPABASE_PROJECT_REF set: $([[ -n "$PROJECT_REF" ]] && echo yes || echo no)"
  echo "  SUPABASE_ACCESS_TOKEN set: $([[ -n "$ACCESS_TOKEN" ]] && echo yes || echo no)"
  echo "  Migrations present:"
  ls -1 supabase/migrations/*bob_* 2>/dev/null || true
  exit 0
fi

if [[ -n "$DB_URL" ]]; then
  echo "[bob-migrations] applying migrations via SUPABASE_DB_URL"
  supabase db push --db-url "$DB_URL" --include-all --yes
  echo "[bob-migrations] complete"
  exit 0
fi

if [[ -z "$PROJECT_REF" || -z "$ACCESS_TOKEN" ]]; then
  echo "[bob-migrations] missing required env vars. Provide one of:"
  echo "  1) SUPABASE_DB_URL"
  echo "  2) SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN"
  exit 1
fi

export SUPABASE_ACCESS_TOKEN="$ACCESS_TOKEN"

echo "[bob-migrations] linking project $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

echo "[bob-migrations] pushing migrations"
set +e
push_output="$(supabase db push --include-all --yes 2>&1)"
push_status=$?
set -e

if [[ $push_status -ne 0 ]]; then
  echo "$push_output"
  if grep -qi "duplicate key value violates unique constraint \"schema_migrations_pkey\"" <<<"$push_output"; then
    echo "[bob-migrations] detected migration history drift; applying Bob migrations directly as fallback"
    supabase db query --linked -f supabase/migrations/20260514232747_bob_memory_layer.sql
    supabase db query --linked -f supabase/migrations/20260514233156_bob_system_ledger.sql
    supabase migration repair --status applied 20260514232747
    supabase migration repair --status applied 20260514233156
  else
    exit $push_status
  fi
fi

echo "[bob-migrations] complete"
