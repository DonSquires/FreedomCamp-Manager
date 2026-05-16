#!/usr/bin/env python3

import json
import sys


def main() -> int:
    try:
        try:
            import trulens.core as trulens_module  # type: ignore
        except Exception:
            try:
                import trulens_eval as trulens_module  # type: ignore
            except Exception:
                import trulens as trulens_module  # type: ignore

        payload = {
            "tool": "trulens",
            "status": "pass",
            "version": getattr(trulens_module, "__version__", "unknown"),
            "details": "TruLens import check passed.",
        }
        print(json.dumps(payload))
        return 0
    except Exception as exc:  # pragma: no cover - operational script
        payload = {
            "tool": "trulens",
            "status": "fail",
            "error": str(exc),
            "details": "Install trulens packages in .venv-bob-eval (bash scripts/setup-rag-evals.sh).",
        }
        print(json.dumps(payload))
        return 1


if __name__ == "__main__":
    sys.exit(main())
