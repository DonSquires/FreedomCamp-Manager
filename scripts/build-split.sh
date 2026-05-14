#!/usr/bin/env bash
set -euo pipefail

# Split typecheck/build path for environments where tsc build mode can be externally terminated.
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/tsc -p tsconfig.node.json --noEmit
./node_modules/.bin/vite build
