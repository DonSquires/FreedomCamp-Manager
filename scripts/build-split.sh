#!/usr/bin/env bash
set -euo pipefail

# Split typecheck/build path for environments where tsc build mode can be externally terminated.
run_with_sigterm_retry() {
	local label="$1"
	shift

	"$@" && return 0
	local code=$?

	if [[ $code -eq 143 ]]; then
		echo "[build:split] ${label} exited 143; retrying once..."
		"$@"
		return $?
	fi

	return $code
}

run_vite_with_fallback() {
  run_with_sigterm_retry "vite build" ./node_modules/.bin/vite build && return 0
  local code=$?

  if [[ $code -eq 143 ]]; then
    echo "[build:split] vite build remained unstable; retrying in degraded mode (--minify=false)..."
    ./node_modules/.bin/vite build --minify=false
    return $?
  fi

  return $code
}

run_with_sigterm_retry "tsc app" ./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
run_with_sigterm_retry "tsc node" ./node_modules/.bin/tsc -p tsconfig.node.json --noEmit
run_vite_with_fallback
