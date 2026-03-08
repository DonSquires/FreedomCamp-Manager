#!/usr/bin/env python3
"""Bulk-archive ParkPow photos from Visits or Vehicles APIs.

This script supports incremental sync using a created timestamp checkpoint.
It is dependency-free (Python stdlib only).

Examples:
  python3 scripts/archive_parkpow_photos.py \
    --source visits \
    --out-dir ./archives/parkpow \
    --state-file ./.parkpow-photo-state.json

  python3 scripts/archive_parkpow_photos.py \
    --source vehicles \
    --created-param created__gt \
    --since 2026-02-01T00:00:00Z
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://api.parkpow.com/api/v1"
DEFAULT_STATE_FILE = ".parkpow-photo-archive-state.json"
DEFAULT_CREATED_PARAM = "created__gt"
DEFAULT_TIMEOUT = 45
DEFAULT_PAGE_SIZE = 100
DEFAULT_SOURCE = "visits"


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


@dataclass
class Stats:
    records_seen: int = 0
    records_with_image: int = 0
    downloaded: int = 0
    skipped_existing: int = 0
    skipped_no_image: int = 0
    download_failures: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Archive ParkPow photos in bulk.")
    parser.add_argument("--api-token", default=os.getenv("PARKPOW_API_TOKEN", ""), help="ParkPow API token (or set PARKPOW_API_TOKEN)")
    parser.add_argument("--base-url", default=os.getenv("PARKPOW_BASE_URL", DEFAULT_BASE_URL), help="ParkPow API base URL")
    parser.add_argument("--source", choices=["visits", "vehicles"], default=DEFAULT_SOURCE, help="API source endpoint")
    parser.add_argument("--out-dir", default="archives/parkpow-photos", help="Where to save downloaded photos")
    parser.add_argument("--state-file", default=DEFAULT_STATE_FILE, help="Checkpoint file for incremental sync")
    parser.add_argument("--since", default="", help="Override checkpoint with ISO timestamp, e.g. 2026-02-01T00:00:00Z")
    parser.add_argument("--created-param", default=DEFAULT_CREATED_PARAM, help="Query param for incremental filter, e.g. created__gt")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE, help="Records per page")
    parser.add_argument("--max-pages", type=int, default=0, help="Optional hard limit for pages (0 = no limit)")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="HTTP timeout seconds")
    parser.add_argument("--sleep-ms", type=int, default=0, help="Optional delay between page requests")
    parser.add_argument("--dry-run", action="store_true", help="Do not download files or update state")
    parser.add_argument("--write-index", action="store_true", help="Write downloaded metadata to index.ndjson")
    return parser.parse_args()


def ensure_token(token: str) -> str:
    t = (token or "").strip()
    if not t:
        raise SystemExit("Missing API token. Set PARKPOW_API_TOKEN or pass --api-token.")
    return t


def normalize_base_url(url: str) -> str:
    cleaned = (url or "").strip().rstrip("/")
    if not cleaned:
        return DEFAULT_BASE_URL
    return cleaned


def parse_iso8601(value: str) -> Optional[datetime]:
    if not value:
        return None
    s = value.strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def isoformat_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def load_state(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    out: Dict[str, str] = {}
    for k, v in data.items():
        if isinstance(k, str) and isinstance(v, str):
            out[k] = v
    return out


def save_state(path: Path, state: Dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def make_api_url(base_url: str, source: str, params: Dict[str, str]) -> str:
    endpoint = "visits/" if source == "visits" else "vehicles/"
    return f"{base_url}/{endpoint}?{urlencode(params)}"


def http_get_json(url: str, token: str, timeout: int) -> Dict[str, object]:
    req = Request(url, headers={"Authorization": f"Token {token}", "Accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body)
            if not isinstance(data, dict):
                raise RuntimeError("Unexpected JSON shape (expected object)")
            return data
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail[:400]}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc}") from exc


def resolve_next_url(current_url: str, next_value: object) -> Optional[str]:
    if not next_value:
        return None
    if isinstance(next_value, str):
        n = next_value.strip()
        if not n:
            return None
        return urljoin(current_url, n)
    return None


def iter_results(
    base_url: str,
    source: str,
    token: str,
    timeout: int,
    since: Optional[str],
    created_param: str,
    page_size: int,
    max_pages: int,
    sleep_ms: int,
) -> Iterator[Dict[str, object]]:
    params: Dict[str, str] = {"limit": str(max(1, page_size))}
    if since:
        params[created_param] = since

    url = make_api_url(base_url, source, params)
    page = 0

    while url:
        page += 1
        if max_pages > 0 and page > max_pages:
            break

        payload = http_get_json(url, token, timeout)
        results = payload.get("results")
        if not isinstance(results, list):
            raise RuntimeError("API response missing list field 'results'")

        print(f"Page {page}: {len(results)} records")

        for row in results:
            if isinstance(row, dict):
                yield row

        url = resolve_next_url(url, payload.get("next"))

        if sleep_ms > 0 and url:
            time.sleep(sleep_ms / 1000.0)


def first_str(data: Dict[str, object], keys: Iterable[str]) -> Optional[str]:
    for key in keys:
        v = data.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def extract_image_url(record: Dict[str, object]) -> Optional[str]:
    # Covers common ParkPow image field names and nested collections.
    direct = first_str(
        record,
        [
            "image_url",
            "snapshot_url",
            "photo_url",
            "vehicle_image_url",
            "plate_image_url",
            "camera_image_url",
        ],
    )
    if direct:
        return direct

    for list_key in ("images", "captures", "snapshots"):
        values = record.get(list_key)
        if isinstance(values, list):
            for item in values:
                if isinstance(item, dict):
                    nested = first_str(item, ["url", "image_url", "snapshot_url", "photo_url"])
                    if nested:
                        return nested

    meta = record.get("metadata")
    if isinstance(meta, dict):
        nested = first_str(meta, ["image_url", "snapshot_url", "photo_url"])
        if nested:
            return nested

    return None


def detect_created_value(record: Dict[str, object]) -> Optional[str]:
    return first_str(record, ["created", "created_at", "entry_time", "time", "timestamp"])


def sanitize_piece(value: str, fallback: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    s = s.strip("._-")
    if not s:
        return fallback
    return s[:80]


def infer_extension(url: str, content_type: str) -> str:
    path = urlparse(url).path
    tail = Path(path).suffix.lower()
    if tail in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}:
        return tail
    ct = (content_type or "").lower()
    if "png" in ct:
        return ".png"
    if "webp" in ct:
        return ".webp"
    if "gif" in ct:
        return ".gif"
    return ".jpg"


def build_output_path(root: Path, source: str, record: Dict[str, object], image_url: str, content_type: str) -> Path:
    created = detect_created_value(record) or datetime.now(timezone.utc).isoformat()
    dt = parse_iso8601(created) or datetime.now(timezone.utc)
    month_dir = dt.strftime("%Y-%m")

    rid = sanitize_piece(str(record.get("id", "noid")), "noid")
    plate = sanitize_piece(str(record.get("license_plate", "unknown")), "unknown")
    stamp = dt.strftime("%Y%m%dT%H%M%SZ")
    ext = infer_extension(image_url, content_type)

    file_name = f"{stamp}_{plate}_{rid}{ext}"
    return root / source / month_dir / file_name


def download_binary(url: str, timeout: int) -> Tuple[bytes, str]:
    req = Request(url, headers={"User-Agent": "parkpow-photo-archive/1.0"})
    with urlopen(req, timeout=timeout) as resp:
        content_type = resp.headers.get("Content-Type", "")
        data = resp.read()
        return data, content_type


def append_ndjson(path: Path, row: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=True) + "\n")


def main() -> int:
    args = parse_args()
    token = ensure_token(args.api_token)
    base_url = normalize_base_url(args.base_url)
    out_dir = Path(args.out_dir)
    state_file = Path(args.state_file)

    state = load_state(state_file)
    state_key = f"{args.source}.created"

    since = args.since.strip() if args.since else ""
    if not since:
        since = state.get(state_key, "")

    if since:
        print(f"Incremental sync from {since} ({args.created_param})")
    else:
        print("Full sync (no --since and no checkpoint)")

    stats = Stats()
    newest_seen: Optional[datetime] = parse_iso8601(since) if since else None

    index_file = out_dir / args.source / "index.ndjson"

    for record in iter_results(
        base_url=base_url,
        source=args.source,
        token=token,
        timeout=max(1, args.timeout),
        since=since or None,
        created_param=args.created_param,
        page_size=max(1, args.page_size),
        max_pages=max(0, args.max_pages),
        sleep_ms=max(0, args.sleep_ms),
    ):
        stats.records_seen += 1

        created_text = detect_created_value(record)
        created_dt = parse_iso8601(created_text or "")
        if created_dt and (newest_seen is None or created_dt > newest_seen):
            newest_seen = created_dt

        image_url = extract_image_url(record)
        if not image_url:
            stats.skipped_no_image += 1
            continue

        stats.records_with_image += 1

        if args.dry_run:
            print(f"[dry-run] {record.get('id')} -> {image_url}")
            continue

        try:
            blob, content_type = download_binary(image_url, timeout=max(1, args.timeout))
            out_path = build_output_path(out_dir, args.source, record, image_url, content_type)
            out_path.parent.mkdir(parents=True, exist_ok=True)

            if out_path.exists() and out_path.stat().st_size > 0:
                stats.skipped_existing += 1
                continue

            out_path.write_bytes(blob)
            stats.downloaded += 1
            print(f"saved {out_path}")

            if args.write_index:
                append_ndjson(
                    index_file,
                    {
                        "source": args.source,
                        "record_id": record.get("id"),
                        "created": created_text,
                        "license_plate": record.get("license_plate"),
                        "image_url": image_url,
                        "saved_path": str(out_path),
                        "bytes": len(blob),
                    },
                )
        except Exception as exc:
            stats.download_failures += 1
            eprint(f"download failed for record {record.get('id')}: {exc}")

    if not args.dry_run and newest_seen is not None:
        state[state_key] = isoformat_z(newest_seen)
        save_state(state_file, state)
        print(f"checkpoint updated: {state_key}={state[state_key]}")

    print("--- summary ---")
    print(f"records_seen={stats.records_seen}")
    print(f"records_with_image={stats.records_with_image}")
    print(f"downloaded={stats.downloaded}")
    print(f"skipped_existing={stats.skipped_existing}")
    print(f"skipped_no_image={stats.skipped_no_image}")
    print(f"download_failures={stats.download_failures}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
