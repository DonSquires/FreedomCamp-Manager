#!/bin/bash
# Git Hook Installation Script
# Installs pre-commit and post-merge hooks for spatial intelligence system
# Usage: bash scripts/setup-git-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SCRIPTS_DIR="$REPO_ROOT/scripts"

echo "📦 Setting up Git hooks..."
echo ""

# Create hooks directory if missing
mkdir -p "$HOOKS_DIR"

# Install pre-commit hook
if [[ -f "$SCRIPTS_DIR/pre-commit.mjs" ]]; then
  cp "$SCRIPTS_DIR/pre-commit.mjs" "$HOOKS_DIR/pre-commit"
  chmod +x "$HOOKS_DIR/pre-commit"
  echo "✅ Installed pre-commit hook"
  echo "   • Runs: npm run bob:test:spatial"
  echo "   • Blocks commits if tests fail"
else
  echo "⚠️  pre-commit.mjs not found"
fi

echo ""
echo "🎯 Hooks installed. Test with:"
echo "   git add ."
echo "   git commit -m 'test: verify hooks work'"
echo ""
echo "⚙️  To uninstall: rm $HOOKS_DIR/pre-commit"
