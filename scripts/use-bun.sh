#!/usr/bin/env sh
set -eu

# Ensure Bun installed in a writable workspace path is available in this shell.
export BUN_INSTALL="/workspaces/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

if [ ! -x "$BUN_INSTALL/bin/bun" ]; then
  echo "Bun is not installed at $BUN_INSTALL/bin/bun"
  echo "Install with: curl -fsSL https://bun.sh/install | BUN_INSTALL=/workspaces/.bun bash"
  exit 1
fi

echo "Using Bun: $(bun --version)"
exec "$@"
