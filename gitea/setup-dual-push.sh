#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
REMOTE_NAME="${REMOTE_NAME:-origin}"
GITEA_PUSH_URL="${GITEA_PUSH_URL:-}"
GITHUB_PUSH_URL="${GITHUB_PUSH_URL:-}"
DRY_RUN="${DRY_RUN:-true}"

if [[ -z "$GITEA_PUSH_URL" || -z "$GITHUB_PUSH_URL" ]]; then
  echo "Set GITEA_PUSH_URL and GITHUB_PUSH_URL before running this script."
  echo "Example:"
  echo "  GITEA_PUSH_URL=git@gitea:your-username/FreedomCamp-Manager.git \\\"
  echo "  GITHUB_PUSH_URL=git@github.com:your-username/FreedomCamp-Manager.git \\\"
  echo "  DRY_RUN=true bash gitea/setup-dual-push.sh"
  exit 1
fi

run_cmd() {
  local cmd="$1"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] $cmd"
    return 0
  fi
  eval "$cmd"
}

cd "$REPO_ROOT"

run_cmd "git remote set-url --delete --push $REMOTE_NAME \"$GITEA_PUSH_URL\" >/dev/null 2>&1 || true"
run_cmd "git remote set-url --delete --push $REMOTE_NAME \"$GITHUB_PUSH_URL\" >/dev/null 2>&1 || true"
run_cmd "git remote set-url --add --push $REMOTE_NAME \"$GITEA_PUSH_URL\""
run_cmd "git remote set-url --add --push $REMOTE_NAME \"$GITHUB_PUSH_URL\""
run_cmd "git remote -v"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run complete. Re-run with DRY_RUN=false to apply changes."
else
  echo "Dual-push mirror configured on remote '$REMOTE_NAME'."
fi
