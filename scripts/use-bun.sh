#!/usr/bin/env sh
set -eu

# Ensure a Bun binary is available in this shell without requiring global install.
# Priority:
# 1) .tools/bin/bun (repo-local)
# 2) /home/vscode/.local/bin/bun (user-local)
# 3) /workspaces/.bun/bin/bun (workspace-local)

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPO_BUN="$ROOT_DIR/.tools/bin/bun"
USER_BUN="/home/vscode/.local/bin/bun"
WORKSPACE_BUN="/workspaces/.bun/bin/bun"

if [ -x "$REPO_BUN" ]; then
  export PATH="$ROOT_DIR/.tools/bin:$PATH"
elif [ -x "$USER_BUN" ]; then
  export PATH="/home/vscode/.local/bin:$PATH"
elif [ -x "$WORKSPACE_BUN" ]; then
  export BUN_INSTALL="/workspaces/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is not installed in any expected local path."
  echo "Expected one of:"
  echo "  $REPO_BUN"
  echo "  $USER_BUN"
  echo "  $WORKSPACE_BUN"
  echo "Install with: curl -fsSL https://bun.sh/install | BUN_INSTALL=/workspaces/.bun bash"
  exit 1
fi

echo "Using Bun: $(bun --version)"
exec "$@"
