#!/usr/bin/env python3
"""RunPod pod lifecycle helper for Bob workflows.

Examples:
  RUNPOD_API_KEY=... RUNPOD_POD_ID=... python3 bob_deploy.py status
  RUNPOD_API_KEY=... RUNPOD_POD_ID=... python3 bob_deploy.py start
  RUNPOD_API_KEY=... RUNPOD_POD_ID=... python3 bob_deploy.py stop
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql"


def graphql_request(api_key: str, query: str, variables: dict) -> dict:
    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        RUNPOD_GRAPHQL_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"RunPod HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"RunPod request failed: {exc.reason}") from exc

    data = json.loads(body)
    if data.get("errors"):
        raise RuntimeError(f"RunPod GraphQL error: {data['errors']}")

    return data.get("data", {})


def pod_status(api_key: str, pod_id: str) -> dict:
    query = """
      query PodStatus($podId: String!) {
        pod(input: { podId: $podId }) {
          id
          name
          desiredStatus
          lastStatusChange
          machine {
            gpuDisplayName
          }
          runtime {
            uptimeInSeconds
            ports {
              privatePort
              publicPort
              ip
              isIpPublic
            }
          }
        }
      }
    """
    data = graphql_request(api_key, query, {"podId": pod_id})
    return data.get("pod") or {}


def start_pod(api_key: str, pod_id: str) -> dict:
    query = """
      mutation StartPod($podId: String!) {
        podResume(input: { podId: $podId, gpuCount: 1 }) {
          id
          desiredStatus
          lastStatusChange
        }
      }
    """
    data = graphql_request(api_key, query, {"podId": pod_id})
    return data.get("podResume") or {}


def stop_pod(api_key: str, pod_id: str) -> dict:
    query = """
      mutation StopPod($podId: String!) {
        stopPod(input: { podId: $podId }) {
          id
          desiredStatus
          lastStatusChange
        }
      }
    """
    data = graphql_request(api_key, query, {"podId": pod_id})
    return data.get("stopPod") or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RunPod control helper for Bob")
    parser.add_argument(
        "action",
        choices=["status", "start", "stop"],
        help="Pod action to perform",
    )
    parser.add_argument(
        "--pod-id",
        default=os.environ.get("RUNPOD_POD_ID", ""),
        help="RunPod pod ID (defaults to RUNPOD_POD_ID)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("RUNPOD_API_KEY", ""),
        help="RunPod API key (defaults to RUNPOD_API_KEY)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.api_key:
        print("RUNPOD_API_KEY is required", file=sys.stderr)
        return 2
    if not args.pod_id:
        print("RUNPOD_POD_ID is required", file=sys.stderr)
        return 2

    try:
        if args.action == "status":
            result = pod_status(args.api_key, args.pod_id)
        elif args.action == "start":
            result = start_pod(args.api_key, args.pod_id)
        else:
            result = stop_pod(args.api_key, args.pod_id)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
