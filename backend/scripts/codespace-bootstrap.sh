#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Normalize alias variables from Codespaces/GitHub secrets.
if [[ -z "${SUPABASE_URL:-}" && -n "${VITE_SUPABASE_URL:-}" ]]; then
  export SUPABASE_URL="$VITE_SUPABASE_URL"
fi

if [[ -z "${SUPABASE_URL:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  export SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"
fi

if [[ -z "${RAILWAY_API_TOKEN:-}" ]]; then
  if [[ -n "${RAILWAY_TOKEN:-}" ]]; then
    export RAILWAY_API_TOKEN="$RAILWAY_TOKEN"
  elif [[ -n "${RAILWAY_CORE_TOKEN:-}" ]]; then
    export RAILWAY_API_TOKEN="$RAILWAY_CORE_TOKEN"
  elif [[ -n "${RAILWAY_STT_TOKEN:-}" ]]; then
    export RAILWAY_API_TOKEN="$RAILWAY_STT_TOKEN"
  fi
fi

required_vars=(SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RAILWAY_API_TOKEN)

missing=0
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "MISSING: $var"
    missing=1
  else
    echo "SET: $var"
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "One or more required variables are missing."
  echo "Add them to backend/.env or export them in this shell, then rerun."
  exit 1
fi

echo "Installing backend dependencies..."
npm install

echo "Building backend..."
npm run build

echo "Verifying Railway token against GraphQL API..."
probe_project_id="${RAILWAY_PROXY_PROJECT_ID:-${RAILWAY_STT_PROJECT_ID:-}}"

if [[ -n "$probe_project_id" ]]; then
  graphql_payload="{\"query\":\"query { project(id: \\\"$probe_project_id\\\") { id name } }\"}"
else
  graphql_payload='{"query":"query { projects { edges { node { id } } } }"}'
fi

set +e
railway_auth_response="$(curl -sS https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$graphql_payload")"
curl_exit=$?
set -e

if [[ "$curl_exit" -ne 0 ]]; then
  echo "Railway authentication check failed: curl exited with code $curl_exit"
  exit 1
fi

if echo "$railway_auth_response" | grep -q '"errors"'; then
  echo "Railway authentication check failed:"
  echo "$railway_auth_response"
  exit 1
fi

if echo "$railway_auth_response" | grep -q 'Not Authorized'; then
  echo "Railway authentication check failed: token is not authorized for probe query"
  echo "$railway_auth_response"
  exit 1
fi

if ! echo "$railway_auth_response" | grep -q '"data"'; then
  echo "Railway authentication check failed: unexpected response"
  echo "$railway_auth_response"
  exit 1
fi

echo "Railway authentication check passed."
echo "Codespace bootstrap complete."
