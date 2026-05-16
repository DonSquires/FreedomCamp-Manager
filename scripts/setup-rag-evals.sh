#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RAGAS_VENV_PATH="${RAGAS_VENV_PATH:-.venv-ragas}"
TRULENS_VENV_PATH="${TRULENS_VENV_PATH:-.venv-trulens}"
PYTHON_BIN="${RAG_EVAL_PYTHON:-python3}"

"$PYTHON_BIN" -m venv "$RAGAS_VENV_PATH"
"$PYTHON_BIN" -m venv "$TRULENS_VENV_PATH"

# shellcheck disable=SC1090
. "$RAGAS_VENV_PATH/bin/activate"
python -m pip install --upgrade pip
python -m pip install --prefer-binary ragas
python scripts/run_ragas_eval.py
deactivate

# shellcheck disable=SC1090
. "$TRULENS_VENV_PATH/bin/activate"
python -m pip install --upgrade pip
python -m pip install --prefer-binary trulens-core trulens-feedback
python scripts/run_trulens_eval.py
deactivate

echo "RAG evaluators ready in $RAGAS_VENV_PATH and $TRULENS_VENV_PATH"
