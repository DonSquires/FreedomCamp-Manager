#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
BACKEND_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

case "$(pwd)" in
  "$BACKEND_ROOT"|"$BACKEND_ROOT"/*) ;;
  *)
    echo "Error: run from backend directory context. Expected under: $BACKEND_ROOT" >&2
    exit 1
    ;;
esac

if [ ! -f "$BACKEND_ROOT/.node-version" ]; then
  echo "Error: missing backend .node-version file" >&2
  exit 1
fi

REQUIRED_NODE="$(tr -d '[:space:]' < "$BACKEND_ROOT/.node-version")"
if [ -z "$REQUIRED_NODE" ]; then
  echo "Error: backend .node-version is empty" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed" >&2
  exit 1
fi

NODE_ACTUAL="$(node -v | sed 's/^v//')"
if [ "$NODE_ACTUAL" != "$REQUIRED_NODE" ]; then
  echo "Error: Node version mismatch. Required $REQUIRED_NODE but found $NODE_ACTUAL" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/bob-env-run.sh <npm-args...>" >&2
  exit 1
fi

NPM_SPEC="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p.packageManager||''));" "$BACKEND_ROOT/package.json")"

case "$NPM_SPEC" in
  npm@*) ;;
  *)
    echo "Error: backend packageManager must be npm@<version>" >&2
    exit 1
    ;;
esac

if command -v corepack >/dev/null 2>&1; then
  if corepack npm --version >/dev/null 2>&1; then
    exec corepack npm "$@"
  fi
fi

exec npm exec --yes --package "$NPM_SPEC" npm -- "$@"
