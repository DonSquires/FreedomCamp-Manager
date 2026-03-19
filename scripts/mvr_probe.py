#!/usr/bin/env python3
"""
MVR ArcGIS probe utility.

Purpose:
- Validate whether ArcGIS FeatureServer query endpoints are publicly reachable.
- Inspect available fields and check if registration-like columns exist.
- Fetch a single sample row for quick inspection of vehicle detail attributes.

Usage examples:
  python3 scripts/mvr_probe.py
  python3 scripts/mvr_probe.py --service https://services.arcgis.com/.../FeatureServer/0
  python3 scripts/mvr_probe.py --service https://.../MVR_Aug2025/FeatureServer/0 --full-sample
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


DEFAULT_SERVICES = [
    "https://services.arcgis.com/CXBb7LAjgIIdcsPt/arcgis/rest/services/MVR_Mar26/FeatureServer/0",
    "https://services.arcgis.com/CXBb7LAjgIIdcsPt/arcgis/rest/services/MVR_Aug2025/FeatureServer/0",
]


def query(service_url: str, params: dict[str, Any], timeout: int = 45) -> dict[str, Any]:
    base = service_url.rstrip("/") + "/query"
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{base}?{q}", headers={"User-Agent": "FreedomCamp-MVR-Probe/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def is_registration_like(name: str) -> bool:
    lower = name.lower()
    return any(token in lower for token in ["plate", "reg", "registration", "licen"])


def probe_service(service_url: str, full_sample: bool) -> None:
    print(f"\n=== Service: {service_url} ===")

    try:
        count_payload = query(
            service_url,
            {
                "f": "json",
                "where": "1=1",
                "returnCountOnly": "true",
            },
        )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        print(f"Status: HTTP {exc.code}")
        print(f"Error: {body[:500]}")
        return
    except Exception as exc:  # pragma: no cover
        print(f"Request failed: {exc}")
        return

    if "error" in count_payload:
        print("Status: query denied")
        print(json.dumps(count_payload["error"], indent=2))
        return

    print("Status: query reachable")
    print(f"Feature count: {count_payload.get('count', 'unknown')}")

    sample_payload = query(
        service_url,
        {
            "f": "json",
            "where": "1=1",
            "outFields": "*",
            "resultRecordCount": "1",
            "returnGeometry": "false",
        },
    )

    if "error" in sample_payload:
        print("Sample query error:")
        print(json.dumps(sample_payload["error"], indent=2))
        return

    fields = [f.get("name", "") for f in sample_payload.get("fields", [])]
    reg_fields = [f for f in fields if is_registration_like(f)]
    print(f"Field count: {len(fields)}")
    print(f"Registration-like fields: {reg_fields if reg_fields else 'none detected'}")

    sample_features = sample_payload.get("features") or []
    sample_attrs = (sample_features[0] or {}).get("attributes") if sample_features else None
    if not isinstance(sample_attrs, dict):
        print("No sample attributes returned")
        return

    if full_sample:
        print("Sample attributes (full):")
        print(json.dumps(sample_attrs, indent=2, default=str))
        return

    preferred = [
        "MAKE",
        "MODEL",
        "BASIC_COLOUR",
        "VEHICLE_YEAR",
        "FIRST_NZ_REGISTRATION_YEAR",
        "MOTIVE_POWER",
        "BODY_TYPE",
        "VIN11",
    ]
    compact = {k: sample_attrs.get(k) for k in preferred if k in sample_attrs}
    if compact:
        print("Sample vehicle-detail attributes:")
        print(json.dumps(compact, indent=2, default=str))
    else:
        print("Sample attributes (first 12 keys):")
        keys = sorted(sample_attrs.keys())[:12]
        print(json.dumps({k: sample_attrs.get(k) for k in keys}, indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe ArcGIS MVR FeatureServer endpoints")
    parser.add_argument(
        "--service",
        action="append",
        dest="services",
        help="FeatureServer layer URL (repeatable). Defaults to known MVR endpoints.",
    )
    parser.add_argument(
        "--full-sample",
        action="store_true",
        help="Print complete sample attributes instead of a compact vehicle subset.",
    )
    args = parser.parse_args()

    services = args.services or DEFAULT_SERVICES
    for service in services:
        probe_service(service, full_sample=args.full_sample)


if __name__ == "__main__":
    main()
