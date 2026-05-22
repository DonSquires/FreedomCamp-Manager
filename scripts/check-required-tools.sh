#!/usr/bin/env bash
set -euo pipefail

# Verifies required CLI tools and reports install hints for missing ones.
# Usage: bash scripts/check-required-tools.sh

required_tools=(
  bash
  git
  curl
  wget
  jq
  node
  npm
  python3
  rg
)

missing=()

for tool in "${required_tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool")
  fi
done

echo "Toolchain check"
echo "--------------"
for tool in "${required_tools[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    version_line="$($tool --version 2>/dev/null | head -n 1 || true)"
    if [[ -z "$version_line" ]]; then
      version_line="available"
    fi
    echo "[ok] $tool - $version_line"
  else
    echo "[missing] $tool"
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo
  echo "Missing tools: ${missing[*]}"
  echo "Install (root Alpine):"
  echo "  apk add --no-cache bash git curl wget jq nodejs npm python3 make g++ ripgrep"
  echo
  echo "If root install is unavailable, use the non-root rg fallback in docs/STAGING.md."
  exit 1
fi

echo
echo "All required tools are available."
