# Bob RAG and TruLens Setup

## Why Two Virtual Environments

Ragas and TruLens currently have dependency constraints that can conflict in one Python environment on Alpine-based dev containers.

- Ragas stack pulls packages that require newer `dill` variants.
- TruLens core currently pins `dill<0.4.0`.

To avoid resolver conflicts, this repository uses two venvs:

- `.venv-ragas` for Ragas checks
- `.venv-trulens` for TruLens checks

## One-Command Setup

```bash
bash scripts/setup-rag-evals.sh
```

This creates both virtual environments, installs dependencies, and runs smoke checks.

## Manual Checks

```bash
. .venv-ragas/bin/activate && python scripts/run_ragas_eval.py
. .venv-trulens/bin/activate && python scripts/run_trulens_eval.py
```

## Gate Integration

The operational gate script uses these defaults:

- Ragas command: `. .venv-ragas/bin/activate && python scripts/run_ragas_eval.py`
- TruLens command: `. .venv-trulens/bin/activate && python scripts/run_trulens_eval.py`

You can override either command with:

```bash
node scripts/bob-operational-testing-gate.mjs \
  --ragas-cmd "<custom command>" \
  --trulens-cmd "<custom command>"
```

## CI

Workflow [ops-bob-operational-testing-gate.yml](.github/workflows/ops-bob-operational-testing-gate.yml) runs setup before the gate and uploads scorecards as artifacts.
