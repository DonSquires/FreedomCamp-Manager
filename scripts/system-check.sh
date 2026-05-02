#!/usr/bin/env bash
set -euo pipefail

# system-check.sh - Generates a reality snapshot for Bob/Dr Bob

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Checking system state for Bob..."

if command -v lsb_release >/dev/null 2>&1; then
  OS_DESC="$(lsb_release -d | cut -f2 | sed 's/"/\\"/g')"
elif [[ -f /etc/os-release ]]; then
  OS_DESC="$(grep '^PRETTY_NAME=' /etc/os-release | cut -d= -f2- | tr -d '"' | sed 's/"/\\"/g')"
else
  OS_DESC="unknown"
fi

NODE_VERSION="$(node -v 2>/dev/null || echo 'not installed')"
BUN_VERSION="$(bun -v 2>/dev/null || echo 'not installed')"
TOOLCHAIN_READY="false"
if [[ "$NODE_VERSION" != "not installed" && "$BUN_VERSION" != "not installed" ]]; then
  TOOLCHAIN_READY="true"
fi

MODULES_JSON='[]'
if [[ -d src/modules ]]; then
  MODULE_LINES="$(for d in src/modules/*; do if [[ -d "$d" ]]; then basename "$d"; fi; done | sort)"
  if command -v jq >/dev/null 2>&1; then
    MODULES_JSON="$(printf '%s\n' "$MODULE_LINES" | jq -R -s -c 'split("\n") | map(select(length > 0))')"
  else
    # Node may not be installed in minimal containers; use POSIX tools for JSON fallback.
    MODULES_JSON="$(printf '%s\n' "$MODULE_LINES" | awk 'BEGIN{printf "["} NF{gsub(/\\/,"\\\\"); gsub(/\"/,"\\\""); if(n++) printf ","; printf "\"%s\"", $0} END{printf "]"}')"
  fi
fi

LOCKFILES=()
[[ -f bun.lock ]] && LOCKFILES+=("\"bun.lock\"")
[[ -f package-lock.json ]] && LOCKFILES+=("\"package-lock.json\"")
[[ -f pnpm-lock.yaml ]] && LOCKFILES+=("\"pnpm-lock.yaml\"")
[[ -f yarn.lock ]] && LOCKFILES+=("\"yarn.lock\"")
LOCKFILES_JSON="[$(IFS=,; echo "${LOCKFILES[*]-}")]"

cat > system_state.json <<EOF
{
  "os": "$OS_DESC",
  "node_version": "$NODE_VERSION",
  "bun_version": "$BUN_VERSION",
  "toolchain_ready": $TOOLCHAIN_READY,
  "modules": $MODULES_JSON,
  "lockfiles": $LOCKFILES_JSON,
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "scripts/system-check.sh"
}
EOF

echo "System state captured in system_state.json"
