#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "SUPABASE_PROJECT_REF not set; skipping live type generation"
  exit 0
fi

if command -v supabase >/dev/null 2>&1 && supabase --version >/dev/null 2>&1; then
  supabase gen types typescript --project-id "$SUPABASE_PROJECT_REF" > src/types.ts
  exit 0
fi

if npx --yes supabase --version >/dev/null 2>&1; then
  npx --yes supabase gen types typescript --project-id "$SUPABASE_PROJECT_REF" > src/types.ts
  exit 0
fi

echo "Supabase CLI unavailable; skipping live type generation"
exit 0