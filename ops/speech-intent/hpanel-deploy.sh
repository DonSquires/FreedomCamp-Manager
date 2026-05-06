#!/usr/bin/env sh
set -eu

# Deploys speech-router to hPanel VPS using this repository.
# Run on hPanel host as a user with docker + git permissions.

REPO_URL="${REPO_URL:-https://github.com/DonSquires/FreedomCamp-Manager.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
BASE_DIR="${BASE_DIR:-/opt/fieldops}"
REPO_DIR="${REPO_DIR:-$BASE_DIR/FreedomCamp-Manager}"
SPEECH_DIR="$REPO_DIR/ops/speech-intent"

echo "[deploy] base dir: $BASE_DIR"
mkdir -p "$BASE_DIR"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[deploy] cloning repo..."
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
echo "[deploy] fetching latest $REPO_BRANCH..."
git fetch --all --prune
git checkout "$REPO_BRANCH"
git pull --ff-only origin "$REPO_BRANCH"

cd "$SPEECH_DIR"

if [ ! -f .env ]; then
  echo "[deploy] creating .env from .env.example"
  cp .env.example .env
  echo "[deploy] edit $SPEECH_DIR/.env before first start (set ROUTER_API_KEY, STT_URL, STT_API_KEY)"
fi

echo "[deploy] building and starting speech-router"
docker compose up -d --build

echo "[deploy] waiting for health endpoint"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:8080/health" >/dev/null 2>&1; then
    echo "[deploy] speech-router healthy"
    docker compose ps
    exit 0
  fi
  sleep 3
done

echo "[deploy] health check failed; showing recent logs"
docker compose logs --tail=120 speech-router
exit 1
