#!/usr/bin/env python3

import json
import sys


def main() -> int:
    try:
        import ragas  # type: ignore

        payload = {
            "tool": "ragas",
            "status": "pass",
            "version": getattr(ragas, "__version__", "unknown"),
            "details": "Ragas import check passed.",
        }
        print(json.dumps(payload))
        return 0
    except Exception as exc:  # pragma: no cover - operational script
        payload = {
            "tool": "ragas",
            "status": "fail",
            "error": str(exc),
            "details": "Install ragas in .venv-bob-eval (bash scripts/setup-rag-evals.sh).",
        }
        print(json.dumps(payload))
        return 1


if __name__ == "__main__":
    sys.exit(main())
