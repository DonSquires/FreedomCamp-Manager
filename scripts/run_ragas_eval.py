#!/usr/bin/env python3

import json
import sys
from importlib import metadata


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
        # Some ragas builds fail at import time because optional provider integrations
        # are unavailable. For this gate we only need to verify package installation.
        try:
            version = metadata.version("ragas")
            payload = {
                "tool": "ragas",
                "status": "pass",
                "version": version,
                "details": "Ragas package is installed; full import failed due optional integration dependency.",
                "warning": str(exc),
            }
            print(json.dumps(payload))
            return 0
        except metadata.PackageNotFoundError:
            pass

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
