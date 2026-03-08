#!/usr/bin/env sh
set -eu

# Manual deployment workaround for when GitHub-hosted Actions are blocked.
# Usage:
#   scripts/manual-supabase-deploy.sh functions
#   scripts/manual-supabase-deploy.sh db
#   scripts/manual-supabase-deploy.sh all

MODE="${1:-all}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-kxwjcupuxnnbnzcgmkoi}"
PUBLIC_FUNCTIONS="orc-ingest vehicle-ingest alpr-process alpr-retry plate-scanner-photo-first stream-webhook get-weather send-push-notification"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPO_SUPABASE="$ROOT_DIR/.tools/bin/supabase"

if [ -x "$REPO_SUPABASE" ]; then
  export PATH="$ROOT_DIR/.tools/bin:$PATH"
fi

case "$MODE" in
  functions|db|all) ;;
  *)
    echo "Invalid mode: $MODE"
    echo "Use one of: functions | db | all"
    exit 1
    ;;
esac

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI not found."
  echo "Checked: $REPO_SUPABASE"
  echo "Install options:"
  echo "  npm i -g supabase"
  echo "  or: brew install supabase/tap/supabase"
  exit 1
fi

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "Missing SUPABASE_ACCESS_TOKEN"
  echo "Create one at https://supabase.com/dashboard/account/tokens"
  exit 1
fi

if [ "$MODE" = "db" ] || [ "$MODE" = "all" ]; then
  if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
    echo "Missing SUPABASE_DB_PASSWORD (required for db push)"
    exit 1
  fi
fi

echo "Project: $PROJECT_REF"
supabase --version

if [ "$MODE" = "functions" ] || [ "$MODE" = "all" ]; then
  echo "Deploying Edge Functions..."
  cd supabase/functions
  success=0
  failed=0

  for fn in */; do
    fn="${fn%/}"
    [ "$fn" = "_shared" ] && continue

    JWT_FLAG=""
    for pub in $PUBLIC_FUNCTIONS; do
      if [ "$fn" = "$pub" ]; then
        JWT_FLAG="--no-verify-jwt"
        break
      fi
    done

    echo "-> Deploying $fn $JWT_FLAG"
    if supabase functions deploy "$fn" --project-ref "$PROJECT_REF" $JWT_FLAG; then
      success=$((success + 1))
    else
      echo "WARNING: failed to deploy $fn"
      failed=$((failed + 1))
    fi
  done

  echo "Functions deploy complete: $success succeeded, $failed failed"
  cd ../..
fi

if [ "$MODE" = "db" ] || [ "$MODE" = "all" ]; then
  echo "Applying database migrations..."
  supabase link --project-ref "$PROJECT_REF"
  supabase db push --include-all --password "$SUPABASE_DB_PASSWORD"
  echo "Database migrations applied"
fi

echo "Done"
