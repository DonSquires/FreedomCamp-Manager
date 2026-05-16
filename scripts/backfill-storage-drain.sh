#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Run storage backfill in deterministic batches until exhausted.

Usage:
  bash scripts/backfill-storage-drain.sh --bucket <name> --organization-id <uuid> [options]

Options:
  --bucket <name>             Required. Storage bucket name.
  --organization-id <uuid>    Required. Fallback organization id.
  --prefix <path>             Optional. Repeatable.
  --limit <n>                 Batch size. Default: 100.
  --start-offset <n>          Initial offset. Default: 0.
  --max-batches <n>           Safety cap. Default: 100.
  --apply                     Perform writes. Omit for dry-run only.
  --verbose                   Pass verbose mode to inner script.
  --help                      Show this help.

Examples:
  bash scripts/backfill-storage-drain.sh --bucket evidence --organization-id <org-uuid>
  bash scripts/backfill-storage-drain.sh --bucket evidence --organization-id <org-uuid> --apply
  bash scripts/backfill-storage-drain.sh --bucket evidence --organization-id <org-uuid> --prefix bob-intake --apply
HELP
}

BUCKET=""
ORG_ID=""
LIMIT=100
START_OFFSET=0
MAX_BATCHES=100
APPLY=false
VERBOSE=false
PREFIXES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket)
      BUCKET="${2:-}"
      shift 2
      ;;
    --organization-id)
      ORG_ID="${2:-}"
      shift 2
      ;;
    --prefix)
      PREFIXES+=("${2:-}")
      shift 2
      ;;
    --limit)
      LIMIT="${2:-100}"
      shift 2
      ;;
    --start-offset)
      START_OFFSET="${2:-0}"
      shift 2
      ;;
    --max-batches)
      MAX_BATCHES="${2:-100}"
      shift 2
      ;;
    --apply)
      APPLY=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$BUCKET" || -z "$ORG_ID" ]]; then
  echo "--bucket and --organization-id are required." >&2
  usage >&2
  exit 2
fi

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || [[ "$LIMIT" -le 0 ]]; then
  echo "--limit must be a positive integer." >&2
  exit 2
fi
if ! [[ "$START_OFFSET" =~ ^[0-9]+$ ]]; then
  echo "--start-offset must be a non-negative integer." >&2
  exit 2
fi
if ! [[ "$MAX_BATCHES" =~ ^[0-9]+$ ]] || [[ "$MAX_BATCHES" -le 0 ]]; then
  echo "--max-batches must be a positive integer." >&2
  exit 2
fi

COMMON_ARGS=(--bucket "$BUCKET" --organization-id "$ORG_ID" --limit "$LIMIT")
if [[ "$VERBOSE" == true ]]; then
  COMMON_ARGS+=(--verbose)
fi
for p in "${PREFIXES[@]}"; do
  COMMON_ARGS+=(--prefix "$p")
done

mode_label="dry-run"
if [[ "$APPLY" == true ]]; then
  mode_label="apply"
fi

echo "[DrainStart] mode=${mode_label} bucket=${BUCKET} start_offset=${START_OFFSET} limit=${LIMIT} max_batches=${MAX_BATCHES}"

offset="$START_OFFSET"
batches=0
scanned_total=0
staged_total=0
failed_total=0

for ((i=0; i<MAX_BATCHES; i++)); do
  batches=$((batches + 1))

  dry_output="$(node scripts/backfill-bob-intakes-from-storage.mjs "${COMMON_ARGS[@]}" --offset "$offset")"

  scanned="$(echo "$dry_output" | awk -F': ' '/^  scanned:/ {print $2}' | tail -n1)"
  staged="$(echo "$dry_output" | awk -F': ' '/^  staged:/ {print $2}' | tail -n1)"
  failed="$(echo "$dry_output" | awk -F': ' '/^  failed:/ {print $2}' | tail -n1)"

  if [[ -z "$scanned" || -z "$staged" || -z "$failed" ]]; then
    echo "$dry_output"
    echo "Failed parsing summary for offset ${offset}." >&2
    exit 1
  fi

  scanned_total=$((scanned_total + scanned))
  failed_total=$((failed_total + failed))

  echo "[Batch] offset=${offset} dry_scanned=${scanned} dry_staged=${staged} dry_failed=${failed}"

  if [[ "$staged" -eq 0 ]]; then
    echo "[DrainStop] No stageable rows at offset ${offset}."
    break
  fi

  if [[ "$APPLY" == true ]]; then
    apply_output="$(node scripts/backfill-bob-intakes-from-storage.mjs --apply "${COMMON_ARGS[@]}" --offset "$offset")"
    apply_staged="$(echo "$apply_output" | awk -F': ' '/^  staged:/ {print $2}' | tail -n1)"
    apply_failed="$(echo "$apply_output" | awk -F': ' '/^  failed:/ {print $2}' | tail -n1)"

    if [[ -z "$apply_staged" || -z "$apply_failed" ]]; then
      echo "$apply_output"
      echo "Failed parsing apply summary for offset ${offset}." >&2
      exit 1
    fi

    staged_total=$((staged_total + apply_staged))
    failed_total=$((failed_total + apply_failed))
    echo "[Apply] offset=${offset} staged=${apply_staged} failed=${apply_failed}"

    if [[ "$apply_failed" -gt 0 ]]; then
      echo "[DrainStop] Apply reported failures at offset ${offset}."
      exit 1
    fi
  else
    staged_total=$((staged_total + staged))
  fi

  offset=$((offset + LIMIT))
done

echo "[DrainSummary] batches=${batches} scanned_total=${scanned_total} staged_total=${staged_total} failed_total=${failed_total} mode=${mode_label}"
