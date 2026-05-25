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
)

optional_tools=(
  rg
)

missing=()

for tool in "${required_tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool")
  fi
done

optional_missing=()
for tool in "${optional_tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    optional_missing+=("$tool")
  fi
done

echo "Toolchain check"
echo "--------------"
echo "Policy: npm-only runtime (bun is not supported for this app workflow)."
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

for tool in "${optional_tools[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    version_line="$($tool --version 2>/dev/null | head -n 1 || true)"
    if [[ -z "$version_line" ]]; then
      version_line="available"
    fi
    echo "[ok] $tool - $version_line"
  else
    echo "[optional-missing] $tool (fallback to grep)"
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

if [[ ${#optional_missing[@]} -gt 0 ]]; then
  echo
  echo "Optional tools not installed: ${optional_missing[*]}"
  echo "Install for faster code search:"
  echo "  apk add --no-cache ripgrep"
fi

if command -v bun >/dev/null 2>&1; then
  echo
  echo "[notice] bun detected on PATH but this repository policy is npm-only."
fi

echo
echo "npm-only shebang audit"
echo "----------------------"

package_manager=""
if [[ -f package.json ]]; then
  package_manager="$(jq -r '.packageManager // ""' package.json 2>/dev/null || true)"
fi

if [[ -z "$package_manager" || "$package_manager" != npm@* ]]; then
  echo "[error] package.json must declare npm in packageManager (example: npm@10.8.2)"
  exit 1
fi

if [[ -d scripts ]]; then
  bun_shebang_files="$(grep -RIl '^#!/usr/bin/env bun' scripts 2>/dev/null || true)"
  if [[ -n "$bun_shebang_files" ]]; then
    echo "[error] bun shebang detected in scripts/ (npm-only policy violation):"
    echo "$bun_shebang_files"
    exit 1
  fi
fi

echo "[ok] packageManager is npm and no bun shebangs found in scripts/."

echo
echo "All required tools are available."
