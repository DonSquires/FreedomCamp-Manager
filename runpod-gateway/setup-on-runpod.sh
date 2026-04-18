#!/usr/bin/env bash
set -euo pipefail

# setup-on-runpod.sh
#
# Bootstraps runpod-gateway on a RunPod pod, including private-repo clone support
# via GITHUB_TOKEN. Credentials are used only in-memory for this session.

: "${BOB_GATEWAY_KEY:?BOB_GATEWAY_KEY is required}"

GITHUB_OWNER="${GITHUB_OWNER:-DonSquires}"
GITHUB_REPO="${GITHUB_REPO:-FreedomCamp-Manager}"
REPO_DIR_NAME="${REPO_DIR_NAME:-repo}"

if [[ -d "/workspace" ]]; then
  BASE_DIR="/workspace"
else
  BASE_DIR="${HOME}"
fi

echo "Using base dir: ${BASE_DIR}"
cd "${BASE_DIR}"

clone_url="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  clone_url="https://${GITHUB_OWNER}:${GITHUB_TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git"
fi

if [[ -d "${REPO_DIR_NAME}/.git" ]]; then
  echo "Repo exists at ${BASE_DIR}/${REPO_DIR_NAME}; pulling latest..."
  git -C "${REPO_DIR_NAME}" pull --ff-only
else
  echo "Cloning ${GITHUB_OWNER}/${GITHUB_REPO}..."
  git clone "${clone_url}" "${REPO_DIR_NAME}"
fi

mkdir -p "${BASE_DIR}/runpod-gateway"
cp -r "${BASE_DIR}/${REPO_DIR_NAME}/runpod-gateway/." "${BASE_DIR}/runpod-gateway/"

cd "${BASE_DIR}/runpod-gateway"
npm install --production

cat > .env <<EOF
BOB_GATEWAY_KEY=${BOB_GATEWAY_KEY}
BOB_GATEWAY_ADMIN_KEY=${BOB_GATEWAY_ADMIN_KEY:-}
OLLAMA_HOST=${OLLAMA_HOST:-http://127.0.0.1:11434}
PORT=${PORT:-8080}
NODE_ENV=production
EOF

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete runpod-gateway 2>/dev/null || true
  pm2 start server.js --name runpod-gateway --env production
  pm2 save
  echo "Gateway started with pm2"
else
  pkill -f "node server.js" 2>/dev/null || true
  nohup node server.js > "${BASE_DIR}/gateway.log" 2>&1 &
  echo "Gateway started with nohup; logs: ${BASE_DIR}/gateway.log"
fi

sleep 2
curl -s "http://127.0.0.1:${PORT:-8080}/gateway/health" || true

echo "Done. Expose port ${PORT:-8080} in RunPod and set RUNPOD_GATEWAY_URL in GitHub secrets."
