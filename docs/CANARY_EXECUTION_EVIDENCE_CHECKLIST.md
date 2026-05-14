# Phase B Canary Execution Evidence Checklist

Date: 2026-05-14
Owner: Operations + Product Lead
Status: Ready for operator execution

## Scope

Use this checklist to produce consistent rollout evidence for one Phase B flag transition path:

0% -> 5% -> 25% -> 50% -> 100%

Required flag examples:
- FF_PHASE_B_PATROL_EVENTS
- FF_PHASE_B_DISPATCH_EVENTS
- FF_PHASE_B_ENFORCEMENT_EVENTS
- FF_PHASE_B_DISPATCH_ACK
- FF_PHASE_B_ENFORCEMENT_TIMELINE

## Prerequisites

1. Environment variables set:
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_URL (or VITE_SUPABASE_URL)

2. Baseline script checks:
- bash scripts/advance-canary-stage.sh --help
- bash scripts/rollback-feature-flag.sh --help

3. Confirm current inventory before any change:

```bash
set -a && . ./.env.playwright.local && set +a
curl -s "${VITE_SUPABASE_URL}/rest/v1/feature_flags?select=id,name,enabled,rollout_percentage&name=like.FF_PHASE_B_%25&order=name.asc" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | jq '.'
```

## Evidence Workflow

Run these steps for a single flag, replacing FLAG_NAME.

### Step 1 - Non-destructive dry-run proof

```bash
FLAG_NAME=FF_PHASE_B_PATROL_EVENTS
bash scripts/advance-canary-stage.sh --dry-run "$FLAG_NAME"
```

Expected: script shows current percentage and calculated next stage, with no writes.

### Step 2 - Promote stage

```bash
bash scripts/advance-canary-stage.sh "$FLAG_NAME" 5
```

Repeat for 25, 50, and 100 only after threshold validation for each stage window.

### Step 3 - Capture rollout history evidence

```bash
curl -s "${VITE_SUPABASE_URL}/rest/v1/feature_flags?select=id,name,enabled,rollout_percentage,updated_at&name=eq.${FLAG_NAME}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | jq '.'

curl -s "${VITE_SUPABASE_URL}/rest/v1/feature_flag_rollout_history?select=flag_id,from_percentage,to_percentage,stage,change_reason,created_at&order=created_at.desc&limit=20" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | jq '.'
```

### Step 4 - Threshold gate before next stage

Required operating thresholds before each promotion:
- Error rate < 1.0%
- p95 latency < 500ms

Record source links or dashboard screenshots in the staging log entry.

### Step 5 - Emergency rollback validation path

```bash
bash scripts/rollback-feature-flag.sh "$FLAG_NAME"
```

Immediately verify the flag returned to 0% and `enabled=false` if your rollback policy requires full disable.

## Suggested Evidence Bundle

Store command outputs under one timestamped folder for auditability:

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR="tmp/canary-evidence-${STAMP}"
mkdir -p "$OUT_DIR"
```

Recommended files:
- help-advance.txt
- help-rollback.txt
- dry-run.txt
- stage-5.txt
- stage-25.txt
- stage-50.txt
- stage-100.txt
- flag-final.json
- rollout-history.json
- rollback.txt (if tested)

## Stop Condition for Live Data Enrichment

Before starting storage-bucket-backed live-data enrichment tasks, pause and ask Bob to review storage buckets and propose enrichment actions.
