#!/usr/bin/env sh
set -eu

# Compatibility wrapper that ensures npm/node are available, then executes
# the passed command unchanged. Retains filename for backward compatibility.

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
USER_NODE_BIN="/home/vscode/.local/bin"

if [ -d "$USER_NODE_BIN" ]; then
  export PATH="$USER_NODE_BIN:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or not in PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed or not in PATH."
  exit 1
fi

echo "Using npm: $(npm --version)"
exec "$@"
