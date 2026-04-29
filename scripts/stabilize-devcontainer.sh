#!/usr/bin/env sh
set -eu

echo "[stabilize] Memory before:" 
free -h || true

# Keep only newest 2 VS Code log sessions.
LOGROOT="/home/vscode/.vscode-remote/data/logs"
if [ -d "$LOGROOT" ]; then
  echo "[stabilize] Pruning old VS Code logs..."
  cd "$LOGROOT"
  ls -dt */ 2>/dev/null | tail -n +3 | xargs -r rm -rf || true
fi

# Kill stale older extensionHost / tsserver processes while keeping latest set.
# Strategy: find oldest extensionHost and terminate only those older than newest one.
EXT_PIDS=$(ps -eo pid,lstart,cmd | grep 'type=extensionHost' | grep -v grep | awk '{print $1}' || true)
if [ -n "$EXT_PIDS" ]; then
  NEWEST_EXT_PID=$(ps -eo pid,lstart,cmd | grep 'type=extensionHost' | grep -v grep | awk '{print $1}' | tail -n 1)
  for p in $EXT_PIDS; do
    if [ "$p" != "$NEWEST_EXT_PID" ]; then
      kill "$p" 2>/dev/null || true
    fi
  done
fi

# Kill orphaned tsserver processes not attached to the newest cancellation pipe group.
NEWEST_PIPE_GROUP=$(ps -eo pid,cmd | grep 'tsserver.js' | grep -v grep | sed -n 's#.*tmp/vscode-typescript1000/\([^/]*\)/.*#\1#p' | tail -n 1)
if [ -n "$NEWEST_PIPE_GROUP" ]; then
  ps -eo pid,cmd | grep 'tsserver.js' | grep -v grep | while read -r pid cmd; do
    echo "$cmd" | grep -q "$NEWEST_PIPE_GROUP" || kill "$pid" 2>/dev/null || true
  done
fi

echo "[stabilize] Memory after:"
free -h || true

echo "[stabilize] Active extensionHost/tsserver processes:"
ps -eo pid,%mem,cmd | grep -E 'extensionHost|tsserver.js' | grep -v grep || true

echo "[stabilize] Done."
